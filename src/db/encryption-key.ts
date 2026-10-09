import { DatabaseSetupError } from './errors';

/** Nombre de la clave en el almacén seguro. Cambiar el sufijo implica una base nueva. */
export const DATABASE_KEY_NAME = 'splitmate.db.key.v1';

const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

export interface KeyStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export interface KeyDeps {
  store: KeyStore;
  randomBytes(length: number): Uint8Array;
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Devuelve la clave de cifrado de la base local: 256 bits aleatorios en hexadecimal.
 * Se genera en el primer arranque y se guarda en el almacén seguro del sistema. La clave
 * se valida como hexadecimal porque se interpola en `PRAGMA key`.
 */
export async function getOrCreateDatabaseKey({ store, randomBytes }: KeyDeps): Promise<string> {
  const existing = await store.getItemAsync(DATABASE_KEY_NAME);
  if (existing !== null) {
    if (!KEY_PATTERN.test(existing)) {
      throw new DatabaseSetupError('KEY_INVALID', 'La clave guardada no tiene el formato esperado');
    }
    return existing;
  }
  const key = toHex(randomBytes(KEY_BYTES));
  await store.setItemAsync(DATABASE_KEY_NAME, key);
  return key;
}
