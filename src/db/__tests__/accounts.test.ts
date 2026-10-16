/// <reference types="node" />
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

import { createIdGenerator } from '@/lib/ids';

import {
  ACCOUNT_REGISTRY_KEY,
  LEGACY_DATABASE,
  accountDatabaseFile,
  accountKeyName,
  createAccountDatabases,
  type Account,
  type AccountDatabaseDeps,
} from '../accounts';
import { DATABASE_KEY_NAME } from '../encryption-key';
import { createRepositories, type AppDatabase } from '../repositories';
import { readSetting, SETTING_KEYS } from '../repositories/local-settings';
import { readLocalUser } from '../repositories/profile';
import { groupMembers, groups, schema, users } from '../schema';

const MIGRATIONS = path.join(__dirname, '..', 'migrations');

let repoTime = 1_770_000_000_000;
const repoNow = () => (repoTime += 1);
const repoDeps = {
  now: repoNow,
  newId: createIdGenerator({ now: repoNow, randomBytes: (n) => new Uint8Array(n).fill(9) }),
};

const ANA: Account = {
  userId: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  email: 'ana@example.com',
  displayName: 'Ana García',
  fallbackName: 'Usuario',
};
const BETO: Account = {
  userId: '7a2b3c4d-5e6f-4a7b-9c8d-0e1f2a3b4c5d',
  email: 'beto@example.com',
  displayName: 'Beto',
  fallbackName: 'Usuario',
};

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

/**
 * Un teléfono falso: archivos de base (sql.js) que solo abren con la clave con la que se crearon,
 * como SQLCipher; el almacén seguro de claves; el kv-store del registro; y la lista de lo que
 * pasó, en orden.
 */
function createPhone() {
  const files = new Map<string, { sqlite: Database; key: string }>();
  const keys = new Map<string, string>();
  const kv = new Map<string, string>();
  const events: string[] = [];
  let seed = 1;
  let time = 1_760_000_000_000;

  function connect(file: string, key: string) {
    let stored = files.get(file);
    if (stored && stored.key !== key) {
      throw new Error('file is not a database');
    }
    if (!stored) {
      const sqlite = new SQL.Database();
      // Anota el cambio de diario: así se ve que ocurre antes de cerrar.
      const prepare = sqlite.prepare.bind(sqlite);
      sqlite.prepare = (statement, params) => {
        if (/journal_mode\s*=\s*delete/i.test(statement)) {
          events.push(`journal_mode=DELETE ${file}`);
        }
        return prepare(statement, params);
      };
      stored = { sqlite, key };
      files.set(file, stored);
    }
    stored.sqlite.run('PRAGMA foreign_keys = ON');
    const db = drizzle(stored.sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS });
    return db as unknown as AppDatabase;
  }

  const deps: AccountDatabaseDeps = {
    keys: {
      getItemAsync: async (name) => keys.get(name) ?? null,
      setItemAsync: async (name, value) => {
        keys.set(name, value);
      },
      deleteItemAsync: async (name) => {
        keys.delete(name);
      },
    },
    registry: {
      getItem: async (name) => kv.get(name) ?? null,
      setItem: async (name, value) => {
        kv.set(name, value);
      },
    },
    randomBytes: (length) => new Uint8Array(length).fill(seed++),
    async openFile(file, key) {
      const db = connect(file, key);
      events.push(`open ${file}`);
      return {
        db,
        close: () => events.push(`close ${file}`),
      };
    },
    deleteFile(file) {
      if (files.delete(file)) {
        events.push(`delete ${file}`);
      }
    },
    now: () => (time += 1),
  };

  return { deps, files, keys, kv, events, connect };
}

type Phone = ReturnType<typeof createPhone>;

/**
 * La base de las Fases 1 y 2, como la deja la app antes del login: un usuario local, un grupo
 * con un gasto y la clave en el almacén seguro.
 */
function seedLegacyDatabase(phone: Phone) {
  const key = 'a'.repeat(64);
  phone.keys.set(DATABASE_KEY_NAME, key);
  const db = phone.connect(LEGACY_DATABASE.file, key);
  let time = 1_750_000_000_000;
  const now = () => (time += 1);
  const repos = createRepositories(db, {
    now,
    newId: createIdGenerator({ now, randomBytes: (n) => new Uint8Array(n).fill(3) }),
  });
  const me = repos.profile.ensure('Ana');
  const group = repos.groups.create({
    name: 'Viaje',
    currency: 'USD',
    createdBy: me.id,
    members: [{ displayName: 'Ana', userId: me.id }, { displayName: 'Beto' }],
  });
  const [ana, beto] = repos.members.listByGroup(group.id);
  repos.expenses.add({
    groupId: group.id,
    title: 'Cena',
    amount: 3000,
    currency: 'USD',
    payers: [{ memberId: ana!.id, amount: 3000 }],
    split: { method: 'equal', participants: [ana!.id, beto!.id] },
    occurredOn: '2026-10-01',
  });
  return { localUserId: me.id, groupId: group.id };
}

function registry(phone: Phone): Record<string, { file: string; keyName: string }> {
  const raw = phone.kv.get(ACCOUNT_REGISTRY_KEY);
  return raw ? (JSON.parse(raw) as { accounts: Record<string, never> }).accounts : {};
}

describe('bases por cuenta', () => {
  describe('adopción de la base de las Fases 1 y 2', () => {
    it('el usuario local pasa a tener el id de la cuenta, con sus referencias', async () => {
      const phone = createPhone();
      const legacy = seedLegacyDatabase(phone);
      const accounts = createAccountDatabases(phone.deps);

      const { db } = await accounts.open(ANA);

      const allUsers = db.select().from(users).all();
      expect(allUsers.map((u) => u.id)).toEqual([ANA.userId]);
      expect(allUsers[0]).toMatchObject({ displayName: 'Ana García', email: ANA.email });
      expect(db.select().from(groups).get()).toMatchObject({
        id: legacy.groupId,
        createdBy: ANA.userId,
      });
      expect(
        db.select().from(groupMembers).where(eq(groupMembers.displayName, 'Ana')).get()?.userId,
      ).toBe(ANA.userId);
      expect(readLocalUser(db)?.id).toBe(ANA.userId);
      expect(readSetting(db, SETTING_KEYS.accountOwnerId)).toBe(ANA.userId);
      // Los datos siguen ahí.
      const repos = createRepositories(db, repoDeps);
      expect(repos.groups.list()).toHaveLength(1);
      expect(registry(phone)[ANA.userId]).toEqual(LEGACY_DATABASE);
    });

    it('no deja filas fantasma por sincronizar: solo quedan pendientes las filas que cambiaron de usuario', async () => {
      const phone = createPhone();
      seedLegacyDatabase(phone);
      // Todo lo de la base vieja ya estaba al día con el servidor.
      const legacy = phone.files.get(LEGACY_DATABASE.file)?.sqlite as Database;
      for (const table of [
        'groups',
        'group_members',
        'categories',
        'expenses',
        'expense_payers',
        'expense_splits',
        'transfers',
      ]) {
        legacy.run(`UPDATE ${table} SET synced_version = version, server_version = version`);
      }
      const accounts = createAccountDatabases(phone.deps);

      const { db } = await accounts.open(ANA);

      const rows = (sql: string) => legacy.exec(sql)[0]?.values ?? [];
      // El usuario local viejo se borró de verdad: `users` no se sincroniza y nada le apunta.
      expect(
        db
          .select()
          .from(users)
          .all()
          .map((u) => u.id),
      ).toEqual([ANA.userId]);
      for (const table of ['sync_outbox', 'sync_conflicts', 'sync_cursors']) {
        expect(rows(`SELECT count(*) FROM ${table}`)).toEqual([[0]]);
      }
      // El grupo (created_by nuevo) y el miembro "yo" (user_id nuevo) suben; Beto y el gasto, no.
      expect(rows(`SELECT name FROM groups WHERE synced_version <> version`)).toEqual([['Viaje']]);
      expect(
        rows(`SELECT display_name FROM group_members WHERE synced_version <> version`),
      ).toEqual([['Ana']]);
      for (const table of ['expenses', 'expense_payers', 'expense_splits']) {
        expect(rows(`SELECT count(*) FROM ${table} WHERE synced_version <> version`)).toEqual([
          [0],
        ]);
      }
    });

    it('repetirla no duplica nada', async () => {
      const phone = createPhone();
      seedLegacyDatabase(phone);
      const accounts = createAccountDatabases(phone.deps);

      (await accounts.open(ANA)).close();
      const { db } = await accounts.open(ANA);

      expect(db.select().from(users).all()).toHaveLength(1);
      expect(db.select().from(groups).all()).toHaveLength(1);
      expect(db.select().from(groupMembers).all()).toHaveLength(2);
    });

    it('si se cortó antes de anotarla en el registro, la cuenta vuelve a encontrar su base', async () => {
      const phone = createPhone();
      seedLegacyDatabase(phone);
      (await createAccountDatabases(phone.deps).open(ANA)).close();
      phone.kv.delete(ACCOUNT_REGISTRY_KEY);

      const { db } = await createAccountDatabases(phone.deps).open(ANA);
      expect(db.select().from(groups).all()).toHaveLength(1);
      expect(registry(phone)[ANA.userId]).toEqual(LEGACY_DATABASE);
      expect(phone.files.has(accountDatabaseFile(ANA.userId))).toBe(false);
    });

    it('sin nombre en la cuenta conserva el nombre local', async () => {
      const phone = createPhone();
      seedLegacyDatabase(phone);
      const { db } = await createAccountDatabases(phone.deps).open({ ...ANA, displayName: null });
      expect(readLocalUser(db)?.displayName).toBe('Ana');
    });
  });

  describe('otras cuentas', () => {
    it('una segunda cuenta en el mismo teléfono empieza con una base vacía', async () => {
      const phone = createPhone();
      seedLegacyDatabase(phone);
      const accounts = createAccountDatabases(phone.deps);
      (await accounts.open(ANA)).close();

      const { db } = await accounts.open(BETO);

      expect(db.select().from(groups).all()).toHaveLength(0);
      expect(
        db
          .select()
          .from(users)
          .all()
          .map((u) => u.id),
      ).toEqual([BETO.userId]);
      expect(readLocalUser(db)?.id).toBe(BETO.userId);
      expect(registry(phone)[BETO.userId]).toEqual({
        file: accountDatabaseFile(BETO.userId),
        keyName: accountKeyName(BETO.userId),
      });
      expect(phone.keys.get(accountKeyName(BETO.userId))).toMatch(/^[0-9a-f]{64}$/);
    });

    it('sin datos de las Fases 1 y 2 crea la base de la cuenta con su usuario; sin nombre, el de respaldo y nunca el correo', async () => {
      const phone = createPhone();
      const { db } = await createAccountDatabases(phone.deps).open({ ...ANA, displayName: null });

      expect(phone.files.has(LEGACY_DATABASE.file)).toBe(false);
      expect(readLocalUser(db)).toMatchObject({
        id: ANA.userId,
        email: ANA.email,
        displayName: 'Usuario',
      });
      expect(readSetting(db, SETTING_KEYS.accountOwnerId)).toBe(ANA.userId);
    });

    it('volver a entrar abre la misma base de la cuenta', async () => {
      const phone = createPhone();
      const accounts = createAccountDatabases(phone.deps);
      const first = await accounts.open(BETO);
      createRepositories(first.db, repoDeps).groups.create({
        name: 'Casa',
        currency: 'EUR',
        createdBy: BETO.userId,
        members: [{ displayName: 'Beto', userId: BETO.userId }],
      });
      first.close();

      const { db } = await accounts.open(BETO);
      expect(db.select().from(groups).all()).toHaveLength(1);
    });

    it('si el registro está dañado, igual encuentra la base de la cuenta', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const phone = createPhone();
      (await createAccountDatabases(phone.deps).open(BETO)).close();
      phone.kv.set(ACCOUNT_REGISTRY_KEY, '{"no":"es un registro"');

      const { db } = await createAccountDatabases(phone.deps).open(BETO);
      expect(readLocalUser(db)?.id).toBe(BETO.userId);
      expect(registry(phone)[BETO.userId]?.file).toBe(accountDatabaseFile(BETO.userId));
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('una base con otro dueño no se abre', async () => {
      const phone = createPhone();
      seedLegacyDatabase(phone);
      const accounts = createAccountDatabases(phone.deps);
      (await accounts.open(ANA)).close();
      // El registro apunta, por error o a propósito, a la base de Ana para Beto.
      const tampered = { version: 1, accounts: { [BETO.userId]: LEGACY_DATABASE } };
      phone.kv.set(ACCOUNT_REGISTRY_KEY, JSON.stringify(tampered));

      await expect(accounts.open(BETO)).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
      expect(phone.events.at(-1)).toBe(`close ${LEGACY_DATABASE.file}`);
    });
  });

  describe('borrar los datos de una cuenta', () => {
    it('vacía el WAL, cierra, borra el archivo, la clave y la entrada del registro', async () => {
      const phone = createPhone();
      const accounts = createAccountDatabases(phone.deps);
      (await accounts.open(BETO)).close();
      phone.events.length = 0;

      await accounts.deleteData(BETO.userId);

      const file = accountDatabaseFile(BETO.userId);
      expect(phone.events).toEqual([
        `open ${file}`,
        `journal_mode=DELETE ${file}`,
        `close ${file}`,
        `delete ${file}`,
      ]);
      expect(phone.files.has(file)).toBe(false);
      expect(phone.keys.has(accountKeyName(BETO.userId))).toBe(false);
      expect(registry(phone)[BETO.userId]).toBeUndefined();

      // Volver a entrar empieza de cero.
      const { db } = await accounts.open(BETO);
      expect(db.select().from(groups).all()).toHaveLength(0);
    });

    it('borra la base adoptada de las Fases 1 y 2 y su clave', async () => {
      const phone = createPhone();
      seedLegacyDatabase(phone);
      const accounts = createAccountDatabases(phone.deps);
      (await accounts.open(ANA)).close();

      await accounts.deleteData(ANA.userId);

      expect(phone.files.has(LEGACY_DATABASE.file)).toBe(false);
      expect(phone.keys.has(DATABASE_KEY_NAME)).toBe(false);
      expect(registry(phone)[ANA.userId]).toBeUndefined();
    });

    it('no toca los datos de otra cuenta', async () => {
      const phone = createPhone();
      seedLegacyDatabase(phone);
      const accounts = createAccountDatabases(phone.deps);
      (await accounts.open(ANA)).close();
      (await accounts.open(BETO)).close();

      await accounts.deleteData(BETO.userId);

      expect(phone.files.has(LEGACY_DATABASE.file)).toBe(true);
      expect(registry(phone)[ANA.userId]).toEqual(LEGACY_DATABASE);
    });

    it('sin archivo ni clave termina igual: borrar dos veces no falla', async () => {
      const phone = createPhone();
      const accounts = createAccountDatabases(phone.deps);
      (await accounts.open(BETO)).close();
      await accounts.deleteData(BETO.userId);
      await expect(accounts.deleteData(BETO.userId)).resolves.toBeUndefined();
    });
  });
});
