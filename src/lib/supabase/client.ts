import type { SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { SQLiteStorage } from 'expo-sqlite/kv-store';

import { secureKeyStore } from '@/lib/secure-key-store';

import { createSupabaseClient } from './create-client';
import { readSupabaseEnv } from './env';
import { expoAesGcm } from './expo-aes-gcm';
import { createSessionCipher } from './session-cipher';
import { createEncryptedStorage, type SupportedStorage } from './session-storage';
import { installAuthWebCrypto } from './web-crypto';

/**
 * Base del kv-store de expo-sqlite para la sesión cifrada. Vive en la carpeta de SQLite, que está
 * fuera del respaldo (reglas de Android y marca de iOS).
 */
const AUTH_STORE_NAME = 'splitmate-auth.db';

let app: { client: SupabaseClient; storage: SupportedStorage } | null = null;

/**
 * Cliente de Supabase de la app, con la sesión cifrada. Se crea la primera vez que se pide.
 * Lanza `SupabaseConfigError` si faltan las variables del `.env`.
 */
export function getSupabase(): { client: SupabaseClient; storage: SupportedStorage } {
  if (app) {
    return app;
  }
  installAuthWebCrypto(globalThis, {
    getRandomValues: (array) => {
      if (array) {
        Crypto.getRandomValues(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      }
      return array;
    },
    // Copia a un ArrayBuffer propio: digest no acepta vistas de un SharedArrayBuffer.
    sha256: (data) => Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(data)),
  });
  const env = readSupabaseEnv();
  const storage = createEncryptedStorage({
    cipher: createSessionCipher({
      keyStore: secureKeyStore,
      randomBytes: (length) => Crypto.getRandomBytes(length),
      aes: expoAesGcm,
    }),
    store: new SQLiteStorage(AUTH_STORE_NAME),
  });
  app = { client: createSupabaseClient({ env, storage }), storage };
  return app;
}
