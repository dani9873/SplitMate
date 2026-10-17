import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { deviceStore } from '@/lib/device-store';
import { logger } from '@/lib/logger';
import { secureKeyStore } from '@/lib/secure-key-store';

import { createAccountDatabases, type Account, type OpenedDatabase } from './accounts';
import { excludeDatabaseFromBackup } from './backup-exclusion';
import { DatabaseSetupError } from './errors';
import { assertMigrationsHaveSql } from './migration-guard';
import migrations from './migrations/migrations';
import { schema } from './schema';

/** Expo Go no incluye SQLCipher. Solo ahí se permite una base sin cifrar, para desarrollo. */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Abre (o crea) un archivo de base cifrado, aplica los pragmas y las migraciones pendientes.
 * Si algo falla, cierra la conexión y relanza el error para que la app ofrezca reintentar.
 * Cerrar dos veces no hace nada.
 */
export async function openDatabaseFile(file: string, key: string): Promise<OpenedDatabase> {
  const sqlite = openDatabaseSync(file);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      sqlite.closeSync();
    }
  };
  try {
    excludeFromBackup(sqlite.databasePath);
    unlock(sqlite, key);
    sqlite.execSync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const db = drizzle(sqlite, { schema });
    // Un trozo sin SQL cerraría la app dentro de expo-sqlite: mejor la pantalla de error.
    assertMigrationsHaveSql(migrations);
    await migrate(db, migrations);
    return { db, close };
  } catch (error) {
    close();
    throw error;
  }
}

/** Borra el archivo de una base cerrada. Si no existe, no hace nada. */
function deleteDatabaseFile(file: string): void {
  try {
    deleteDatabaseSync(file);
  } catch (error) {
    // expo-sqlite falla si el archivo no existe: ya está borrado. Otro error (por ejemplo, la
    // base sigue abierta) se propaga para reintentar.
    if (error instanceof Error && /not found/i.test(error.message)) {
      return;
    }
    throw error;
  }
}

/** No bloquea el arranque: la base va cifrada aunque la exclusión falle. */
function excludeFromBackup(databasePath: string): void {
  try {
    excludeDatabaseFromBackup(databasePath);
  } catch (error) {
    logger.warn('No se pudo excluir la base del respaldo de iOS', error);
  }
}

function unlock(sqlite: SQLiteDatabase, key: string): void {
  if (isExpoGo) {
    logger.warn('Expo Go no incluye SQLCipher: esta base de desarrollo no está cifrada.');
    return;
  }
  // La clave se interpola en el PRAGMA: solo hexadecimal de 64 caracteres.
  if (!KEY_PATTERN.test(key)) {
    throw new DatabaseSetupError('KEY_INVALID', 'La clave guardada no tiene el formato esperado');
  }
  // Clave cruda de 256 bits: SQLCipher la usa sin derivación PBKDF2, así abre rápido.
  sqlite.execSync(`PRAGMA key = "x'${key}'";`);
  const cipher = sqlite.getFirstSync<{ cipher_version?: string }>('PRAGMA cipher_version;');
  if (!cipher?.cipher_version) {
    throw new DatabaseSetupError('ENCRYPTION_UNAVAILABLE', 'Este build no incluye SQLCipher');
  }
  // Con una clave equivocada, esta lectura falla con "file is not a database".
  sqlite.getFirstSync('SELECT count(*) FROM sqlite_master;');
}

const accountDatabases = createAccountDatabases({
  keys: {
    ...secureKeyStore,
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
  },
  registry: deviceStore,
  randomBytes: (length) => Crypto.getRandomBytes(length),
  openFile: openDatabaseFile,
  deleteFile: deleteDatabaseFile,
  now: () => Date.now(),
});

/** La base abierta de la cuenta con sesión. Hay una a la vez. */
let current: { readonly userId: string; readonly opened: OpenedDatabase } | null = null;

/** Abre la base de la cuenta con sesión; cierra la que estuviera abierta. */
export async function openAccountDatabase(account: Account): Promise<OpenedDatabase> {
  closeAccountDatabase();
  const opened = await accountDatabases.open(account);
  current = { userId: account.userId, opened };
  return {
    db: opened.db,
    close: () => {
      if (current?.opened === opened) {
        current = null;
      }
      opened.close();
    },
  };
}

export function closeAccountDatabase(): void {
  current?.opened.close();
  current = null;
}

/**
 * Borra del teléfono los datos de una cuenta: su base, su clave y su entrada del registro. Si
 * su base está abierta, la cierra antes: expo-sqlite no borra una base abierta.
 */
export async function deleteAccountData(userId: string): Promise<void> {
  if (current?.userId === userId) {
    closeAccountDatabase();
  }
  await accountDatabases.deleteData(userId);
}
