import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes } from 'node:crypto';

import {
  SESSION_KEY_NAME,
  createSessionCipher,
  type AesGcm,
  type SessionKeyStore,
} from '../session-cipher';
import { createEncryptedStorage, type KeyValueStore } from '../session-storage';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** El mismo AES-256-GCM que expo-crypto, con node:crypto: devuelve IV ‖ cifrado ‖ etiqueta. */
const nodeAesGcm: AesGcm = {
  async encrypt(key, plain, aad) {
    const iv = nodeRandomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return new Uint8Array(Buffer.concat([iv, body, cipher.getAuthTag()]));
  },
  async decrypt(key, sealed, aad) {
    const iv = sealed.subarray(0, IV_BYTES);
    const tag = sealed.subarray(sealed.length - TAG_BYTES);
    const body = sealed.subarray(IV_BYTES, sealed.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
  },
};

function memoryKeyStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store: SessionKeyStore = {
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: jest.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
  };
  return { data, store };
}

function memoryStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
  return { data, store };
}

/** Lo que haría la app en un arranque: un cifrador nuevo sobre los mismos almacenes. */
function boot(keys = memoryKeyStore(), values = memoryStore()) {
  const cipher = createSessionCipher({
    keyStore: keys.store,
    randomBytes: (length) => new Uint8Array(nodeRandomBytes(length)),
    aes: nodeAesGcm,
  });
  return { keys, values, storage: createEncryptedStorage({ cipher, store: values.store }) };
}

const NAME = 'sb-proyecto-auth-token';
const SESSION = JSON.stringify({
  access_token: 'eyJhbGciOiJIUzI1NiJ9.acceso',
  refresh_token: 'refresco-123',
  user: { id: '0199c82c-c000-7000-8000-00000000000a', email: 'ana@example.com', name: 'Ána ñandú' },
});

describe('almacenamiento cifrado de la sesión', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // Ningún aviso registra la sesión ni el texto cifrado.
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('refresco-123');
    expect(logged).not.toContain('v1.');
    warn.mockRestore();
  });

  it('guarda cifrado y devuelve el mismo texto (ida y vuelta)', async () => {
    const { storage, values } = boot();
    await storage.setItem(NAME, SESSION);

    const stored = values.data.get(`auth.${NAME}`);
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain('refresco-123');
    expect(stored).not.toContain('ana@example.com');
    await expect(storage.getItem(NAME)).resolves.toBe(SESSION);
  });

  it('usa un IV nuevo en cada escritura', async () => {
    const { storage, values } = boot();
    await storage.setItem(NAME, SESSION);
    const first = values.data.get(`auth.${NAME}`);
    await storage.setItem(NAME, SESSION);
    expect(values.data.get(`auth.${NAME}`)).not.toBe(first);
  });

  it('guarda sesiones de más de 2048 bytes, el límite de secure-store', async () => {
    const { storage } = boot();
    const large = JSON.stringify({ ...JSON.parse(SESSION), identities: 'x'.repeat(6000) });
    expect(new TextEncoder().encode(large).length).toBeGreaterThan(2048);

    await storage.setItem(NAME, large);
    await expect(storage.getItem(NAME)).resolves.toBe(large);
  });

  it('descarta y borra un valor alterado', async () => {
    const { storage, values } = boot();
    await storage.setItem(NAME, SESSION);
    const stored = values.data.get(`auth.${NAME}`)!;
    const [, payload] = stored.split('.');
    const bytes = Uint8Array.from(atob(payload!), (char) => char.charCodeAt(0));
    bytes[IV_BYTES + 3]! ^= 0x01;
    values.data.set(`auth.${NAME}`, `v1.${btoa(String.fromCharCode(...bytes))}`);

    await expect(storage.getItem(NAME)).resolves.toBeNull();
    expect(values.data.has(`auth.${NAME}`)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('descarta y borra un valor copiado bajo otro nombre (otro AAD)', async () => {
    const { storage, values } = boot();
    await storage.setItem(NAME, SESSION);
    values.data.set('auth.otro-nombre', values.data.get(`auth.${NAME}`)!);

    await expect(storage.getItem('otro-nombre')).resolves.toBeNull();
    expect(values.data.has('auth.otro-nombre')).toBe(false);
    await expect(storage.getItem(NAME)).resolves.toBe(SESSION);
  });

  it('descarta valores con un formato desconocido', async () => {
    const { storage, values } = boot();
    values.data.set(`auth.${NAME}`, SESSION);
    await expect(storage.getItem(NAME)).resolves.toBeNull();
    expect(values.data.has(`auth.${NAME}`)).toBe(false);

    values.data.set(`auth.${NAME}`, 'v1.%%%no-es-base64%%%');
    await expect(storage.getItem(NAME)).resolves.toBeNull();

    values.data.set(`auth.${NAME}`, `v1.${btoa('corto')}`);
    await expect(storage.getItem(NAME)).resolves.toBeNull();
  });

  it('sin clave, un valor guardado se trata como "sin sesión" y no se crea una clave al leer', async () => {
    const { storage, values, keys } = boot();
    await storage.setItem(NAME, SESSION);

    // La clave se perdió (por ejemplo, el sistema borró el almacén seguro).
    const restarted = boot(memoryKeyStore(), values);
    await expect(restarted.storage.getItem(NAME)).resolves.toBeNull();
    expect(values.data.has(`auth.${NAME}`)).toBe(false);
    expect(restarted.keys.store.setItemAsync).not.toHaveBeenCalled();
    expect(keys.data.has(SESSION_KEY_NAME)).toBe(true);
  });

  it('devuelve null si no hay nada guardado', async () => {
    const { storage } = boot();
    await expect(storage.getItem(NAME)).resolves.toBeNull();
  });

  it('crea la clave una sola vez, aunque dos escrituras empiecen juntas', async () => {
    const { storage, keys, values } = boot();
    await Promise.all([storage.setItem(NAME, SESSION), storage.setItem('otro', 'valor')]);
    await storage.setItem(NAME, SESSION);

    expect(keys.store.setItemAsync).toHaveBeenCalledTimes(1);
    expect(keys.data.get(SESSION_KEY_NAME)).toMatch(/^[0-9a-f]{64}$/);
    await expect(storage.getItem('otro')).resolves.toBe('valor');

    // Otro arranque usa la misma clave y lee lo guardado.
    const restarted = boot(keys, values);
    await expect(restarted.storage.getItem(NAME)).resolves.toBe(SESSION);
    await restarted.storage.setItem('tercero', 'x');
    expect(keys.store.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('reemplaza una clave guardada con formato inválido al escribir', async () => {
    const keys = memoryKeyStore({ [SESSION_KEY_NAME]: 'no-es-una-clave' });
    const { storage } = boot(keys);

    await storage.setItem(NAME, SESSION);
    expect(keys.data.get(SESSION_KEY_NAME)).toMatch(/^[0-9a-f]{64}$/);
    await expect(storage.getItem(NAME)).resolves.toBe(SESSION);
  });

  it('removeItem borra el valor', async () => {
    const { storage, values } = boot();
    await storage.setItem(NAME, SESSION);
    await storage.removeItem(NAME);
    expect(values.data.has(`auth.${NAME}`)).toBe(false);
    await expect(storage.getItem(NAME)).resolves.toBeNull();
  });
});
