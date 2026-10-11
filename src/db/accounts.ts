import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logger } from '@/lib/logger';

import { DATABASE_KEY_NAME, getOrCreateDatabaseKey, type KeyStore } from './encryption-key';
import { DatabaseSetupError } from './errors';
import type { AppDatabase } from './repositories';
import { readSetting, SETTING_KEYS, writeSetting } from './repositories/local-settings';
import { groupMembers, groups, users } from './schema';

/**
 * Una base local por cuenta. Cada cuenta abre su propio archivo cifrado con su propia clave; un
 * registro del dispositivo apunta de cada cuenta a su archivo. Los datos de dos cuentas nunca se
 * mezclan: cada base guarda su dueño y no abre para otra cuenta.
 */

/** La cuenta con sesión, como la describe Auth. */
export interface Account {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
}

/** Una base abierta y cómo cerrarla. */
export interface OpenedDatabase {
  readonly db: AppDatabase;
  close(): void;
}

interface DatabaseLocation {
  readonly file: string;
  readonly keyName: string;
}

/** La base de las Fases 1 y 2. Conserva su nombre y su clave cuando una cuenta la adopta. */
export const LEGACY_DATABASE: DatabaseLocation = {
  file: 'splitmate.db',
  keyName: DATABASE_KEY_NAME,
};

/** Nombres fijos por cuenta: aunque el registro se pierda, la cuenta encuentra su base. */
export const accountDatabaseFile = (userId: string) => `account-${userId}.db`;
export const accountKeyName = (userId: string) => `splitmate.db.key.${userId}`;

/** Clave del registro del dispositivo en el kv-store. */
export const ACCOUNT_REGISTRY_KEY = 'accounts.registry';

export interface AccountDatabaseDeps {
  /** El almacén seguro del sistema, donde viven las claves. */
  keys: KeyStore & { deleteItemAsync(key: string): Promise<void> };
  /** El kv-store del dispositivo, donde vive el registro. */
  registry: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
  };
  randomBytes(length: number): Uint8Array;
  /** Abre el archivo con su clave (lo crea si no existe) y aplica las migraciones. */
  openFile(file: string, key: string): Promise<OpenedDatabase>;
  /** Borra el archivo de una base cerrada. Si no existe, no hace nada. */
  deleteFile(file: string): void;
  now(): number;
}

const locationSchema = z.object({
  file: z.string().regex(/^(splitmate|account-[0-9a-f-]{36})\.db$/),
  keyName: z.string().regex(/^splitmate\.db\.key\.(v1|[0-9a-f-]{36})$/),
});

const registrySchema = z.object({
  version: z.literal(1),
  accounts: z.record(z.uuid(), locationSchema),
});

type Registry = Record<string, DatabaseLocation>;

export function createAccountDatabases(deps: AccountDatabaseDeps) {
  async function readRegistry(): Promise<Registry> {
    const raw = await deps.registry.getItem(ACCOUNT_REGISTRY_KEY);
    if (raw === null) {
      return {};
    }
    try {
      return registrySchema.parse(JSON.parse(raw)).accounts;
    } catch {
      // Sin registro, cada cuenta igual encuentra su base: los nombres son fijos y la base de
      // las Fases 1 y 2 dice quién es su dueño.
      logger.warn('El registro de cuentas del dispositivo está dañado; se reconstruye');
      return {};
    }
  }

  async function writeRegistry(registry: Registry): Promise<void> {
    await deps.registry.setItem(
      ACCOUNT_REGISTRY_KEY,
      JSON.stringify({ version: 1, accounts: registry }),
    );
  }

  const keyFor = (location: DatabaseLocation) =>
    getOrCreateDatabaseKey({ store: deps.keys, randomBytes: deps.randomBytes }, location.keyName);

  /**
   * Deja la base lista para la cuenta y la anota en el registro. Antes comprueba el dueño: una
   * base de otra cuenta no se abre. Si algo falla, la cierra.
   */
  async function claim(
    opened: OpenedDatabase,
    location: DatabaseLocation,
    account: Account,
    registry: Registry,
  ): Promise<OpenedDatabase> {
    try {
      const owner = readSetting(opened.db, SETTING_KEYS.accountOwnerId);
      if (owner !== null && owner !== account.userId) {
        throw new DatabaseSetupError('ACCOUNT_MISMATCH', 'La base local es de otra cuenta');
      }
      prepareForAccount(opened.db, account, deps.now());
      const known = registry[account.userId];
      if (known?.file !== location.file || known.keyName !== location.keyName) {
        await writeRegistry({ ...registry, [account.userId]: location });
      }
      return opened;
    } catch (error) {
      opened.close();
      throw error;
    }
  }

  async function openAt(
    location: DatabaseLocation,
    account: Account,
    registry: Registry,
  ): Promise<OpenedDatabase> {
    const opened = await deps.openFile(location.file, await keyFor(location));
    return claim(opened, location, account, registry);
  }

  return {
    /**
     * Abre la base de la cuenta:
     * 1. la del registro;
     * 2. si no está, la de las Fases 1 y 2, que adopta si no tiene dueño o recupera si ya era
     *    suya;
     * 3. si no, una base nueva con su propia clave.
     */
    async open(account: Account): Promise<OpenedDatabase> {
      const registry = await readRegistry();
      const known = registry[account.userId];
      if (known) {
        return openAt(known, account, registry);
      }
      const legacyTaken = Object.entries(registry).some(
        ([userId, location]) => userId !== account.userId && location.file === LEGACY_DATABASE.file,
      );
      const legacyKey = await deps.keys.getItemAsync(LEGACY_DATABASE.keyName);
      if (legacyKey !== null && !legacyTaken) {
        const legacy = await deps.openFile(LEGACY_DATABASE.file, legacyKey);
        const owner = readSetting(legacy.db, SETTING_KEYS.accountOwnerId);
        if (owner === null || owner === account.userId) {
          try {
            adoptLocalUser(legacy.db, account, deps.now());
          } catch (error) {
            legacy.close();
            throw error;
          }
          return claim(legacy, LEGACY_DATABASE, account, registry);
        }
        legacy.close();
      }
      return openAt(
        { file: accountDatabaseFile(account.userId), keyName: accountKeyName(account.userId) },
        account,
        registry,
      );
    },

    /**
     * Borra del teléfono la base de la cuenta, su clave y su entrada del registro. La base debe
     * estar cerrada. Antes de borrarla pasa a `journal_mode = DELETE`, que vacía y elimina el
     * WAL y el SHM: borrar el archivo solo no los toca.
     */
    async deleteData(userId: string): Promise<void> {
      const registry = await readRegistry();
      const location = registry[userId] ?? {
        file: accountDatabaseFile(userId),
        keyName: accountKeyName(userId),
      };
      const key = await deps.keys.getItemAsync(location.keyName);
      if (key !== null) {
        try {
          const opened = await deps.openFile(location.file, key);
          try {
            opened.db.run(sql`PRAGMA journal_mode = DELETE`);
          } finally {
            opened.close();
          }
        } catch (error) {
          // Sin poder abrirla, igual se borra: sin su clave, lo que quede es ilegible.
          logger.warn('No se pudo preparar la base local para borrarla', error);
        }
      }
      deps.deleteFile(location.file);
      await deps.keys.deleteItemAsync(location.keyName);
      const { [userId]: _removed, ...rest } = await readRegistry();
      await writeRegistry(rest);
    },
  };
}

/** Nombre del usuario local: el de la cuenta o, si no tiene, el de su correo. Hasta 80 caracteres. */
function accountName(account: Account): string | null {
  const name = account.displayName?.trim();
  return name ? Array.from(name).slice(0, 80).join('') : null;
}

function emailName(email: string): string {
  return Array.from(email.split('@')[0] || email)
    .slice(0, 80)
    .join('');
}

/**
 * Adopta los datos de las Fases 1 y 2 en una transacción: el usuario local (el de
 * `profile.userId`, o el único `users` si falta ese ajuste) pasa a tener el id de la cuenta, con
 * sus grupos y su miembro, y toma el nombre y el correo de la cuenta. Repetirla no duplica: si el
 * usuario local ya tiene el id de la cuenta, no hay nada que mover.
 */
function adoptLocalUser(db: AppDatabase, account: Account, now: number): void {
  db.transaction((tx) => {
    const localId = readSetting(tx, SETTING_KEYS.localUserId) ?? onlyUserId(tx);
    const previous = localId ? tx.select().from(users).where(eq(users.id, localId)).get() : null;
    if (previous && previous.id !== account.userId) {
      tx.insert(users)
        .values({
          id: account.userId,
          createdAt: previous.createdAt,
          updatedAt: now,
          displayName: accountName(account) ?? previous.displayName,
          email: account.email,
        })
        .run();
      tx.update(groups)
        .set({ createdBy: account.userId, updatedAt: now, version: sql`${groups.version} + 1` })
        .where(eq(groups.createdBy, previous.id))
        .run();
      tx.update(groupMembers)
        .set({
          userId: account.userId,
          updatedAt: now,
          version: sql`${groupMembers.version} + 1`,
        })
        .where(eq(groupMembers.userId, previous.id))
        .run();
      tx.delete(users).where(eq(users.id, previous.id)).run();
    }
    prepareForAccount(tx, account, now);
  });
}

function onlyUserId(db: AppDatabase): string | null {
  const rows = db.select({ id: users.id }).from(users).limit(2).all();
  return rows.length === 1 ? rows[0]!.id : null;
}

/** El usuario local existe con el id de la cuenta y la base queda marcada con su dueño. */
function prepareForAccount(db: AppDatabase, account: Account, now: number): void {
  db.transaction((tx) => {
    const existing = tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, account.userId))
      .get();
    if (!existing) {
      tx.insert(users)
        .values({
          id: account.userId,
          createdAt: now,
          updatedAt: now,
          displayName: accountName(account) ?? emailName(account.email),
          email: account.email,
        })
        .run();
    }
    if (readSetting(tx, SETTING_KEYS.localUserId) !== account.userId) {
      writeSetting(tx, SETTING_KEYS.localUserId, account.userId, now);
    }
    if (readSetting(tx, SETTING_KEYS.accountOwnerId) === null) {
      writeSetting(tx, SETTING_KEYS.accountOwnerId, account.userId, now);
    }
  });
}
