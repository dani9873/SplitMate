import { DATABASE_KEY_NAME, getOrCreateDatabaseKey, type KeyStore } from '../encryption-key';

function memoryStore(
  initial: Record<string, string> = {},
): KeyStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => {
      data.set(key, value);
    },
  };
}

const randomBytes = (length: number) => Uint8Array.from({ length }, (_, i) => i * 7);

describe('clave de cifrado de la base', () => {
  it('genera una clave de 256 bits en hexadecimal y la guarda', async () => {
    const store = memoryStore();
    const key = await getOrCreateDatabaseKey({ store, randomBytes });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(store.data.get(DATABASE_KEY_NAME)).toBe(key);
  });

  it('reutiliza la clave guardada en lugar de crear otra', async () => {
    const store = memoryStore();
    const first = await getOrCreateDatabaseKey({ store, randomBytes });
    const second = await getOrCreateDatabaseKey({
      store,
      randomBytes: () => new Uint8Array(32).fill(255),
    });
    expect(second).toBe(first);
  });

  it('rechaza una clave guardada con formato inválido', async () => {
    const store = memoryStore({ [DATABASE_KEY_NAME]: "x'; DROP TABLE users; --" });
    await expect(getOrCreateDatabaseKey({ store, randomBytes })).rejects.toMatchObject({
      code: 'KEY_INVALID',
    });
  });
});
