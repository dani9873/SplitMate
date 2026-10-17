import type { Database } from 'sql.js';

import { createChangeBus, type ChangeBus } from '@/db/changes';
import { createRepositories, type Repositories } from '@/db/repositories';
import { createSyncRemote, createSyncStore, type SyncRemote, type SyncStore } from '@/db/sync';
import { createTestDatabase, type TestDatabase } from '@/db/test-utils';
import { createIdGenerator } from '@/lib/ids';
import type { SupabaseTestServer } from '@/test/supabase-pglite';

import { runSyncCycle, type SyncCycleOptions, type SyncCycleResult } from './cycle';

/**
 * Dispositivos simulados para probar la sincronización de punta a punta: cada uno tiene su
 * propia base SQLite real (sql.js), sus repositorios, su `SyncStore` y su conexión al servidor de
 * prueba (PGlite con las migraciones reales). Solo para Jest.
 */

type Row = Record<string, unknown>;

/** Contenido de un grupo, comparable entre una base local y el servidor. */
export interface Snapshot {
  readonly groups: Row[];
  readonly members: Row[];
  readonly categories: Row[];
  readonly expenses: Row[];
  readonly transfers: Row[];
}

type Run = (query: string) => Promise<Row[]>;

const asNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const asBoolean = (value: unknown) => value === true || value === 1 || value === 't';

/**
 * Lee el contenido de los grupos dados con SQL que entienden SQLite y Postgres, y lo devuelve con
 * la misma forma en los dos lados: sin fechas de creación, versiones ni estado de sincronización,
 * que son distintos a propósito. Los ids sí son iguales.
 */
export async function readSnapshot(run: Run, groupIds: readonly string[]): Promise<Snapshot> {
  const ids = groupIds.length > 0 ? groupIds.map((id) => `'${id}'`).join(', ') : `''`;
  const inGroups = `group_id IN (${ids})`;
  // Las tablas de pagadores y partes no tienen `group_id` en la base local: se llega por el gasto.
  const ofGroups = `expense_id IN (SELECT id FROM expenses WHERE ${inGroups})`;

  const payers = await run(
    `SELECT expense_id, id, member_id, CAST(amount AS TEXT) AS amount,
            CAST(group_amount AS TEXT) AS group_amount
     FROM expense_payers WHERE deleted_at IS NULL AND ${ofGroups} ORDER BY id`,
  );
  const splits = await run(
    `SELECT expense_id, id, member_id, CAST(amount AS TEXT) AS amount,
            CAST(group_amount AS TEXT) AS group_amount, CAST(input_value AS TEXT) AS input_value
     FROM expense_splits WHERE deleted_at IS NULL AND ${ofGroups} ORDER BY id`,
  );
  const expenses = await run(
    `SELECT id, group_id, kind, title, CAST(amount AS TEXT) AS amount, currency, group_currency,
            CAST(group_amount AS TEXT) AS group_amount, exchange_rate,
            CAST(rate_date AS TEXT) AS rate_date, split_method, category_id,
            CAST(occurred_on AS TEXT) AS occurred_on, notes, deleted_at IS NOT NULL AS deleted
     FROM expenses WHERE ${inGroups} ORDER BY id`,
  );
  const transfers = await run(
    `SELECT id, group_id, from_member_id, to_member_id, CAST(amount AS TEXT) AS amount, currency,
            group_currency, CAST(group_amount AS TEXT) AS group_amount, exchange_rate,
            CAST(rate_date AS TEXT) AS rate_date, CAST(occurred_on AS TEXT) AS occurred_on,
            deleted_at IS NOT NULL AS deleted
     FROM transfers WHERE ${inGroups} ORDER BY id`,
  );

  const lines = (source: Row[], expenseId: unknown, withInput: boolean) =>
    source
      .filter((line) => line.expense_id === expenseId)
      .map((line) => ({
        id: line.id,
        member_id: line.member_id,
        amount: asNumber(line.amount),
        group_amount: asNumber(line.group_amount),
        ...(withInput ? { input_value: asNumber(line.input_value) } : {}),
      }));

  return {
    groups: (
      await run(
        `SELECT id, name, currency, emoji, color, archived_at IS NOT NULL AS archived,
                deleted_at IS NOT NULL AS deleted
         FROM groups WHERE id IN (${ids}) ORDER BY id`,
      )
    ).map((r) => ({ ...r, archived: asBoolean(r.archived), deleted: asBoolean(r.deleted) })),
    members: (
      await run(
        `SELECT id, group_id, display_name, user_id, role, deleted_at IS NOT NULL AS deleted
         FROM group_members WHERE ${inGroups} ORDER BY id`,
      )
    ).map((r) => ({ ...r, deleted: asBoolean(r.deleted) })),
    categories: (
      await run(
        `SELECT id, group_id, name, icon, deleted_at IS NOT NULL AS deleted
         FROM categories WHERE ${inGroups} ORDER BY id`,
      )
    ).map((r) => ({ ...r, deleted: asBoolean(r.deleted) })),
    expenses: expenses.map((r) => ({
      ...r,
      amount: asNumber(r.amount),
      group_amount: asNumber(r.group_amount),
      deleted: asBoolean(r.deleted),
      payers: lines(payers, r.id, false),
      splits: lines(splits, r.id, true),
    })),
    transfers: transfers.map((r) => ({
      ...r,
      amount: asNumber(r.amount),
      group_amount: asNumber(r.group_amount),
      deleted: asBoolean(r.deleted),
    })),
  };
}

/** El contenido que tiene el servidor de prueba de los grupos dados. */
export function serverSnapshot(
  server: SupabaseTestServer,
  groupIds: readonly string[],
): Promise<Snapshot> {
  return readSnapshot((query) => server.query(query), groupIds);
}

function objectRows(sqlite: Database, query: string): Row[] {
  const result = sqlite.exec(query)[0];
  if (!result) {
    return [];
  }
  return result.values.map(
    (values) => Object.fromEntries(result.columns.map((name, i) => [name, values[i]])) as Row,
  );
}

export interface Device {
  readonly userId: string;
  readonly db: TestDatabase;
  readonly sqlite: Database;
  readonly repos: Repositories;
  readonly bus: ChangeBus;
  readonly store: SyncStore;
  /** Las llamadas de este dispositivo al servidor, con `faults.failNext`. */
  readonly rpc: ReturnType<SupabaseTestServer['rpcFor']>;
  readonly remote: SyncRemote;
  /** Crea un grupo en este dispositivo. El primer miembro es "yo", salvo con `withMe: false`. */
  createGroup(options?: {
    name?: string;
    currency?: string;
    members?: readonly string[];
    withMe?: boolean;
  }): { group: ReturnType<Repositories['groups']['create']>; memberIds: string[] };
  /** Un ciclo de sincronización de este dispositivo. */
  sync(options?: Partial<Omit<SyncCycleOptions, 'store' | 'remote'>>): Promise<SyncCycleResult>;
  /** Ids de los grupos de esta base. */
  groupIds(): string[];
  /** Contenido de esta base, comparable con `serverSnapshot`. */
  snapshot(): Promise<Snapshot>;
}

let deviceCount = 0;

/**
 * Un dispositivo con la cuenta `userId` del servidor de prueba. El usuario local es esa cuenta (como
 * tras iniciar sesión). Cada dispositivo genera ids en un rango de tiempo propio, para no chocar
 * con los de otro dispositivo en el mismo servidor.
 */
export async function createDevice(
  server: SupabaseTestServer,
  userId: string,
  { name = 'Ana' }: { name?: string } = {},
): Promise<Device> {
  deviceCount += 1;
  const seed = deviceCount;
  const { db, sqlite } = await createTestDatabase();
  let time = 1_780_000_000_000 + seed * 100_000_000;
  const now = () => (time += 1);
  const newId = createIdGenerator({ now, randomBytes: (n) => new Uint8Array(n).fill(seed % 256) });
  const bus = createChangeBus();
  const repos = createRepositories(db, { now, newId }, { bus });

  sqlite.run(
    `INSERT INTO users (id, created_at, updated_at, version, display_name) VALUES (?, ?, ?, 1, ?)`,
    [userId, now(), now(), name],
  );
  sqlite.run(
    `INSERT INTO local_settings (key, value, updated_at) VALUES ('profile.userId', ?, ?)`,
    [userId, now()],
  );

  const store = createSyncStore(db, bus, { now, newId });
  const rpc = server.rpcFor(userId);
  const remote = createSyncRemote(rpc);

  const groupIds = () => objectRows(sqlite, `SELECT id FROM groups`).map((r) => String(r.id));

  return {
    userId,
    db,
    sqlite,
    repos,
    bus,
    store,
    rpc,
    remote,

    createGroup({ name: groupName = 'Viaje', currency = 'USD', members, withMe = true } = {}) {
      const names = members ?? [name, 'Beto', 'Carla'];
      const group = repos.groups.create({
        name: groupName,
        currency,
        createdBy: userId,
        members: names.map((displayName, index) =>
          index === 0 && withMe ? { displayName, userId } : { displayName },
        ),
      });
      return { group, memberIds: repos.members.listByGroup(group.id).map((m) => m.id) };
    },

    sync: (options = {}) => runSyncCycle({ store, remote, ...options }),

    groupIds,

    snapshot: () => readSnapshot(async (query) => objectRows(sqlite, query), groupIds()),
  };
}
