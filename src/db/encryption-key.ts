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
 * Devuelve la clave de cifrado de una base local: 256 bits aleatorios en hexadecimal.
 * Se genera la primera vez y se guarda en el almacén seguro del sistema. La clave se valida
 * como hexadecimal porque se interpola en `PRAGMA key`. Sin nombre, es la de la base de las
 * Fases 1 y 2; cada cuenta tiene la suya.
 */
export async function getOrCreateDatabaseKey(
  { store, randomBytes }: KeyDeps,
  keyName: string = DATABASE_KEY_NAME,
): Promise<string> {
  const existing = await store.getItemAsync(keyName);
  if (existing !== null) {
    if (!KEY_PATTERN.test(existing)) {
      throw new DatabaseSetupError('KEY_INVALID', 'La clave guardada no tiene el formato esperado');
    }
    return existing;
  }
  const key = toHex(randomBytes(KEY_BYTES));
  await store.setItemAsync(keyName, key);
  return key;
}
