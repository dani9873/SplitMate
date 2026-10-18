import { logger } from '@/lib/logger';

import {
  PENDING_INVITE_TTL_MS,
  clearPendingInvite,
  createPendingInviteStore,
  type SecureValueStore,
} from '../pending-invite';

const TOKEN = 'T'.repeat(43);
const OTHER = 'U'.repeat(43);
const T0 = 1_790_000_000_000;

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: SecureValueStore = {
    getItemAsync: jest.fn(async (key: string) => items.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void items.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void items.delete(key)),
  };
  return { storage, items };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('el enlace pendiente', () => {
  it('se guarda en memoria y en el almacén seguro, con la hora', async () => {
    const { storage, items } = memoryStorage();
    const store = createPendingInviteStore(storage);

    store.set(TOKEN, T0);

    expect(store.peek(T0)).toBe(TOKEN);
    await Promise.resolve();
    expect(JSON.parse([...items.values()][0] as string)).toEqual({ token: TOKEN, at: T0 });
  });

  it('vence en 1 hora: ni en memoria ni en el almacén', async () => {
    const { storage } = memoryStorage();
    const store = createPendingInviteStore(storage);
    store.set(TOKEN, T0);

    expect(store.peek(T0 + PENDING_INVITE_TTL_MS - 1)).toBe(TOKEN);
    expect(store.peek(T0 + PENDING_INVITE_TTL_MS)).toBeNull();
    expect(await store.load(T0 + PENDING_INVITE_TTL_MS)).toBeNull();
    expect(PENDING_INVITE_TTL_MS).toBe(3_600_000);
  });

  it('sin memoria (la app se cerró), lo recupera del almacén seguro', async () => {
    const { storage } = memoryStorage();
    createPendingInviteStore(storage).set(TOKEN, T0);
    await Promise.resolve();

    const reopened = createPendingInviteStore(storage);
    expect(reopened.peek(T0)).toBeNull();
    expect(await reopened.load(T0 + 60_000)).toBe(TOKEN);
    // Y ya queda en memoria para la pantalla.
    expect(reopened.peek(T0 + 60_000)).toBe(TOKEN);
  });

  it('uno vencido en el almacén se borra y no se devuelve', async () => {
    const { storage, items } = memoryStorage();
    createPendingInviteStore(storage).set(TOKEN, T0);
    await Promise.resolve();

    const reopened = createPendingInviteStore(storage);
    expect(await reopened.load(T0 + PENDING_INVITE_TTL_MS + 1)).toBeNull();
    expect(items.size).toBe(0);
  });

  it('lo guardado con otra forma se ignora y se borra', async () => {
    for (const bad of [
      'no es json',
      JSON.stringify({ token: 'corto', at: T0 }),
      JSON.stringify({ token: TOKEN }),
      JSON.stringify({ token: TOKEN, at: 'ayer' }),
      JSON.stringify({ token: TOKEN, at: T0, extra: 1 }),
      JSON.stringify([TOKEN]),
    ]) {
      const { storage, items } = memoryStorage({ 'splitmate.pending-invite': bad });
      const store = createPendingInviteStore(storage);
      expect(await store.load(T0)).toBeNull();
      expect(items.size).toBe(0);
    }
  });

  it('una hora guardada en el futuro (reloj movido) no vale', async () => {
    const { storage } = memoryStorage({
      'splitmate.pending-invite': JSON.stringify({ token: TOKEN, at: T0 + 10 * 60_000 }),
    });
    expect(await createPendingInviteStore(storage).load(T0)).toBeNull();
  });

  it('usar el enlace lo borra de la memoria y del almacén', async () => {
    const { storage, items } = memoryStorage();
    const store = createPendingInviteStore(storage);
    store.set(TOKEN, T0);
    await Promise.resolve();

    await store.clear();

    expect(store.peek(T0)).toBeNull();
    expect(items.size).toBe(0);
    expect(await store.load(T0)).toBeNull();
  });

  it('un enlace nuevo reemplaza al anterior', async () => {
    const { storage } = memoryStorage();
    const store = createPendingInviteStore(storage);
    store.set(TOKEN, T0);
    store.set(OTHER, T0 + 1000);
    expect(store.peek(T0 + 1000)).toBe(OTHER);
    expect(await store.load(T0 + 1000)).toBe(OTHER);
  });

  it('no guarda un token que no tiene la forma esperada', async () => {
    const { storage, items } = memoryStorage();
    const store = createPendingInviteStore(storage);
    store.set('corto', T0);
    expect(store.peek(T0)).toBeNull();
    expect(items.size).toBe(0);
  });

  it('si el almacén seguro falla, sigue funcionando en memoria y no registra el token', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const storage: SecureValueStore = {
      getItemAsync: jest.fn().mockRejectedValue(new Error(`falla con ${TOKEN}`)),
      setItemAsync: jest.fn().mockRejectedValue(new Error(`falla con ${TOKEN}`)),
      deleteItemAsync: jest.fn().mockRejectedValue(new Error(`falla con ${TOKEN}`)),
    };
    const store = createPendingInviteStore(storage);

    store.set(TOKEN, T0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.peek(T0)).toBe(TOKEN);
    await expect(store.clear()).resolves.toBeUndefined();

    const fresh = createPendingInviteStore(storage);
    expect(await fresh.load(T0)).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
  });

  it('clearPendingInvite limpia el almacén de la app', async () => {
    await expect(clearPendingInvite()).resolves.toBeUndefined();
  });
});
