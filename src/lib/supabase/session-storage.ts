import { logger } from '@/lib/logger';

import type { SessionCipher } from './session-cipher';

/** Almacén de texto de la app con la API de AsyncStorage (el kv-store de expo-sqlite). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Lo que supabase-js necesita para guardar la sesión. */
export interface SupportedStorage {
  getItem(name: string): Promise<string | null>;
  setItem(name: string, value: string): Promise<void>;
  removeItem(name: string): Promise<void>;
}

interface EncryptedStorageDeps {
  cipher: SessionCipher;
  store: KeyValueStore;
  /** Prefijo de las claves en el almacén, para no mezclarlas con otros valores. */
  prefix?: string;
}

/**
 * Adaptador de almacenamiento para supabase-js que cifra cada valor antes de guardarlo. Un
 * valor que no descifra (alterado, copiado bajo otro nombre o con la clave perdida) se borra y
 * se trata como "sin sesión". Su contenido nunca se registra.
 */
export function createEncryptedStorage({
  cipher,
  store,
  prefix = 'auth.',
}: EncryptedStorageDeps): SupportedStorage {
  return {
    async getItem(name) {
      const key = prefix + name;
      const blob = await store.getItem(key);
      if (blob === null) {
        return null;
      }
      try {
        return await cipher.decrypt(blob, name);
      } catch {
        logger.warn('Se descartó un valor de la sesión que no se pudo descifrar');
        await store.removeItem(key).catch(() => undefined);
        return null;
      }
    },

    async setItem(name, value) {
      await store.setItem(prefix + name, await cipher.encrypt(value, name));
    },

    async removeItem(name) {
      await store.removeItem(prefix + name);
    },
  };
}
