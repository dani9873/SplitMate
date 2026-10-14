/**
 * Cifrado de los valores de la sesión de Supabase (tokens y usuario): AES-256-GCM con una
 * clave aleatoria de 256 bits guardada en el almacén seguro del sistema.
 *
 * - Cada valor se cifra con un IV nuevo y su nombre como AAD: un texto cifrado copiado bajo
 *   otro nombre no descifra.
 * - Formato: `v1.` + base64 de IV ‖ cifrado ‖ etiqueta.
 * - Sin clave, descifrar falla y no crea una: lo guardado con una clave perdida ya no se lee.
 *
 * El AES-GCM concreto se inyecta: expo-crypto en la app y node:crypto en las pruebas.
 */

/** Nombre de la clave en el almacén seguro. Cambiar el sufijo invalida las sesiones guardadas. */
export const SESSION_KEY_NAME = 'splitmate.session.key.v1';

const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/;
const FORMAT_PREFIX = 'v1.';
/** IV de 12 bytes y etiqueta de 16: lo mínimo que puede medir un valor cifrado. */
const MIN_SEALED_BYTES = 12 + 16;

export interface SessionCipher {
  encrypt(plain: string, aad: string): Promise<string>;
  decrypt(blob: string, aad: string): Promise<string>;
}

/** AES-256-GCM con IV aleatorio de 12 bytes y etiqueta de 16. Devuelve IV ‖ cifrado ‖ etiqueta. */
export interface AesGcm {
  encrypt(key: Uint8Array, plain: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  decrypt(key: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
}

/** El almacén seguro del sistema (expo-secure-store). */
export interface SessionKeyStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export interface SessionCipherDeps {
  keyStore: SessionKeyStore;
  randomBytes(length: number): Uint8Array;
  aes: AesGcm;
}

export class SessionCipherError extends Error {
  constructor(
    readonly code: 'KEY_MISSING' | 'MALFORMED',
    message: string,
  ) {
    super(message);
    this.name = 'SessionCipherError';
  }
}

export function createSessionCipher({
  keyStore,
  randomBytes,
  aes,
}: SessionCipherDeps): SessionCipher {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let cachedKey: Uint8Array | null = null;
  let creatingKey: Promise<Uint8Array> | null = null;

  /** La clave guardada. Una con formato inválido cuenta como perdida. */
  async function storedKey(): Promise<Uint8Array | null> {
    if (cachedKey) {
      return cachedKey;
    }
    const stored = await keyStore.getItemAsync(SESSION_KEY_NAME);
    if (stored === null || !KEY_PATTERN.test(stored)) {
      return null;
    }
    cachedKey = fromHex(stored);
    return cachedKey;
  }

  /** La clave para escribir. Si falta, la crea una sola vez aunque haya escrituras simultáneas. */
  function keyForWriting(): Promise<Uint8Array> {
    creatingKey ??= storedKey()
      .then(async (existing) => {
        if (existing) {
          return existing;
        }
        const created = randomBytes(KEY_BYTES);
        await keyStore.setItemAsync(SESSION_KEY_NAME, toHex(created));
        cachedKey = created;
        return created;
      })
      .finally(() => {
        creatingKey = null;
      });
    return creatingKey;
  }

  return {
    async encrypt(plain, aad) {
      const key = await keyForWriting();
      const sealed = await aes.encrypt(key, encoder.encode(plain), encoder.encode(aad));
      return FORMAT_PREFIX + toBase64(sealed);
    },

    async decrypt(blob, aad) {
      if (!blob.startsWith(FORMAT_PREFIX)) {
        throw new SessionCipherError('MALFORMED', 'Formato de valor cifrado desconocido');
      }
      const sealed = fromBase64(blob.slice(FORMAT_PREFIX.length));
      if (sealed.length < MIN_SEALED_BYTES) {
        throw new SessionCipherError('MALFORMED', 'Valor cifrado demasiado corto');
      }
      const key = await storedKey();
      if (!key) {
        throw new SessionCipherError('KEY_MISSING', 'No hay clave para descifrar la sesión');
      }
      return decoder.decode(await aes.decrypt(key, sealed, encoder.encode(aad)));
    },
  };
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new SessionCipherError('MALFORMED', 'El valor cifrado no es base64');
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
