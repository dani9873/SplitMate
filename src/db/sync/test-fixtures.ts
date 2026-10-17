import { createIdGenerator } from '@/lib/ids';

import { createTestGroup, createTestRepositories } from '../test-utils';
import { createSyncStore } from './store';
import type { PushResult, RemoteRow, SyncTable } from './wire';

/** Instante base de las filas que "manda el servidor" en las pruebas. */
const SERVER_TIME = 1_790_000_000_000;

export const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Una fila como la devuelve el servidor (`to_jsonb`): nombres en snake_case, fechas ISO y las
 * columnas comunes. Cada prueba pasa solo los campos que le importan.
 */
export function serverRow(table: SyncTable, fields: Record<string, unknown>): RemoteRow {
  return {
    table,
    row: {
      created_at: iso(SERVER_TIME),
      updated_at: iso(SERVER_TIME + 1000),
      deleted_at: null,
      version: 1,
      change_seq: 1,
      ...fields,
    },
  };
}

export const applied = (id: string, version: number, current: RemoteRow[] = []): PushResult => ({
  id,
  status: 'applied',
  version,
  current,
});

export const rejected = (
  id: string,
  current: RemoteRow[],
  reason: 'conflict' | 'currency_locked' | 'group_currency_changed' = 'conflict',
): PushResult => ({ id, status: 'rejected', reason, current });

export const failed = (
  id: string,
  reason: 'forbidden' | 'invalid' | 'not_found' | 'error' = 'invalid',
  field?: string,
): PushResult => ({ id, status: 'failed', reason, ...(field ? { field } : {}) });

/** Base local con el grupo "Viaje" (Ana es "yo", Beto y Carla) y su `SyncStore`. */
export async function setupSync() {
  const ctx = await createTestRepositories();
  const grupo = createTestGroup(ctx);
  let time = 1_770_000_000_000;
  const now = () => (time += 1);
  const newId = createIdGenerator({ now, randomBytes: (n) => new Uint8Array(n).fill(9) });
  const store = createSyncStore(ctx.db, ctx.bus, { now, newId });
  return { ...ctx, ...grupo, store, now };
}

export type SyncSetup = Awaited<ReturnType<typeof setupSync>>;

/** Deja todo al día con el servidor: ninguna fila pendiente. */
export function markEverythingSynced(setup: Pick<SyncSetup, 'sqlite'>): void {
  for (const table of [
    'groups',
    'group_members',
    'categories',
    'expenses',
    'expense_payers',
    'expense_splits',
    'transfers',
  ]) {
    setup.sqlite.run(`UPDATE ${table} SET synced_version = version, server_version = version`);
  }
}

/** Primera columna de una consulta, como lista. */
export function column<T = unknown>(setup: Pick<SyncSetup, 'sqlite'>, query: string): T[] {
  return (setup.sqlite.exec(query)[0]?.values ?? []).map((row) => row[0] as T);
}

/** Filas de una consulta como objetos. */
export function rows<T = Record<string, unknown>>(
  setup: Pick<SyncSetup, 'sqlite'>,
  query: string,
): T[] {
  const result = setup.sqlite.exec(query)[0];
  if (!result) {
    return [];
  }
  return result.values.map(
    (values) => Object.fromEntries(result.columns.map((name, i) => [name, values[i]])) as T,
  );
}
