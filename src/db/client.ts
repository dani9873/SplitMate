import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { logger } from '@/lib/logger';

import { getOrCreateDatabaseKey } from './encryption-key';
import { DatabaseSetupError } from './errors';
import migrations from './migrations/migrations';
import type { AppDatabase } from './repositories';
import { schema } from './schema';

export const DATABASE_NAME = 'splitmate.db';

/** Expo Go no incluye SQLCipher. Solo ahí se permite una base sin cifrar, para desarrollo. */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const keyStore = {
  getItemAsync: (key: string) => SecureStore.getItemAsync(key),
  setItemAsync: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, {
      // Solo en este dispositivo y disponible tras el primer desbloqueo: no viaja en copias
      // de seguridad ni a otros dispositivos.
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
};

/**
 * Abre la base local cifrada, aplica los pragmas y las migraciones pendientes.
 * Si algo falla, cierra la conexión y relanza el error para que la app ofrezca reintentar.
 */
export async function openAppDatabase(): Promise<AppDatabase> {
  const key = await getOrCreateDatabaseKey({
    store: keyStore,
    randomBytes: (length) => Crypto.getRandomBytes(length),
  });
  const sqlite = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });
  try {
    unlock(sqlite, key);
    sqlite.execSync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const db = drizzle(sqlite, { schema });
    await migrate(db, migrations);
    return db;
  } catch (error) {
    sqlite.closeSync();
    throw error;
  }
}

function unlock(sqlite: SQLiteDatabase, key: string): void {
  if (isExpoGo) {
    logger.warn('Expo Go no incluye SQLCipher: esta base de desarrollo no está cifrada.');
    return;
  }
  // Clave cruda de 256 bits: SQLCipher la usa sin derivación PBKDF2, así abre rápido.
  // `key` ya se validó como hexadecimal de 64 caracteres.
  sqlite.execSync(`PRAGMA key = "x'${key}'";`);
  const cipher = sqlite.getFirstSync<{ cipher_version?: string }>('PRAGMA cipher_version;');
  if (!cipher?.cipher_version) {
    throw new DatabaseSetupError('ENCRYPTION_UNAVAILABLE', 'Este build no incluye SQLCipher');
  }
  // Con una clave equivocada, esta lectura falla con "file is not a database".
  sqlite.getFirstSync('SELECT count(*) FROM sqlite_master;');
}
