/// <reference types="node" />
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs, { type Database } from 'sql.js';

import { schema } from '../schema';

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const NOW = 1_760_000_000_000;

/** Tablas con datos del usuario que la migración no puede perder ni duplicar. */
const DATA_TABLES = [
  'users',
  'groups',
  'group_members',
  'categories',
  'expenses',
  'expense_payers',
  'expense_splits',
  'transfers',
] as const;

/** Las 7 tablas que se sincronizan (`users` no). */
const SYNC_TABLES = DATA_TABLES.filter((table) => table !== 'users');

/** Copia de las migraciones con el diario recortado a las primeras `count`. */
function migrationsUpTo(count: number): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'splitmate-migrations-'));
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = path.join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

const rows = (sqlite: Database, sql: string) => sqlite.exec(sql)[0]?.values ?? [];
const counts = (sqlite: Database) =>
  Object.fromEntries(
    DATA_TABLES.map((table) => [table, rows(sqlite, `SELECT count(*) FROM ${table}`)[0]?.[0]]),
  );

/** Datos de las Fases 1 a 3: dos grupos en monedas distintas, con movimientos activos y borrados. */
function seedPhase3Data(sqlite: Database) {
  const run = (sql: string, params: (string | number | null)[] = []) => sqlite.run(sql, params);
  run(`INSERT INTO users (id, created_at, updated_at, display_name) VALUES ('u1', ?, ?, 'Ana')`, [
    NOW,
    NOW,
  ]);
  for (const [id, name, currency] of [
    ['g1', 'Viaje', 'USD'],
    ['g2', 'Casa', 'EUR'],
  ] as const) {
    run(
      `INSERT INTO groups (id, created_at, updated_at, name, currency, created_by)
       VALUES (?, ?, ?, ?, ?, 'u1')`,
      [id, NOW, NOW, name, currency],
    );
  }
  for (const [id, groupId, name] of [
    ['m1', 'g1', 'Ana'],
    ['m2', 'g1', 'Beto'],
    ['m3', 'g2', 'Carla'],
    ['m4', 'g2', 'Dani'],
  ] as const) {
    run(
      `INSERT INTO group_members (id, created_at, updated_at, group_id, display_name)
       VALUES (?, ?, ?, ?, ?)`,
      [id, NOW, NOW, groupId, name],
    );
  }
  run(
    `INSERT INTO categories (id, created_at, updated_at, group_id, name, icon)
     VALUES ('c1', ?, ?, 'g1', 'Propina', 'coins')`,
    [NOW, NOW],
  );
  const expense = (id: string, groupId: string, currency: string, deletedAt: number | null) =>
    run(
      `INSERT INTO expenses (id, created_at, updated_at, deleted_at, group_id, kind, title, amount,
         currency, group_amount, split_method, occurred_on, version)
       VALUES (?, ?, ?, ?, ?, 'expense', 'Cena', 3000, ?, 3000, 'equal', '2026-10-09', 3)`,
      [id, NOW, NOW, deletedAt, groupId, currency],
    );
  expense('e1', 'g1', 'USD', null);
  expense('e2', 'g2', 'EUR', null);
  expense('e3', 'g2', 'EUR', NOW + 5);
  const part = (table: 'expense_payers' | 'expense_splits', id: string, expenseId: string) =>
    run(
      `INSERT INTO ${table} (id, created_at, updated_at, expense_id, member_id, amount, group_amount)
       VALUES (?, ?, ?, ?, ?, 1500, 1500)`,
      [id, NOW, NOW, expenseId, expenseId === 'e1' ? 'm1' : 'm3'],
    );
  for (const expenseId of ['e1', 'e2', 'e3']) {
    part('expense_payers', `p-${expenseId}`, expenseId);
    part('expense_splits', `s-${expenseId}`, expenseId);
  }
  run(
    `INSERT INTO transfers (id, created_at, updated_at, group_id, from_member_id, to_member_id,
       amount, currency, group_amount, occurred_on)
     VALUES ('t1', ?, ?, 'g2', 'm3', 'm4', 500, 'EUR', 500, '2026-10-10')`,
    [NOW, NOW],
  );
}

async function migrateOldBase() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const previous = migrationsUpTo(4);
  try {
    migrate(db, { migrationsFolder: previous });
  } finally {
    rmSync(previous, { recursive: true, force: true });
  }
  seedPhase3Data(sqlite);
  const before = counts(sqlite);
  // Las columnas de la base vieja y su contenido, para compararlas después de migrar.
  const oldColumns = Object.fromEntries(
    DATA_TABLES.map((table) => [
      table,
      rows(sqlite, `PRAGMA table_info(${table})`).map((column) => String(column[1])),
    ]),
  );
  const dump = (table: string) =>
    rows(sqlite, `SELECT ${(oldColumns[table] ?? []).join(', ')} FROM ${table} ORDER BY id`);
  const snapshot = Object.fromEntries(DATA_TABLES.map((table) => [table, dump(table)]));
  migrate(db, { migrationsFolder: MIGRATIONS });
  return { sqlite, before, snapshot, dump };
}

describe('migración 0004 sobre una base de la Fase 3 con datos', () => {
  it('conserva todas las filas: los conteos antes y después son idénticos', async () => {
    const { sqlite, before } = await migrateOldBase();
    expect(before).toEqual({
      users: 1,
      groups: 2,
      group_members: 4,
      // 9 predefinidas más la personalizada.
      categories: 10,
      expenses: 3,
      expense_payers: 3,
      expense_splits: 3,
      transfers: 1,
    });
    expect(counts(sqlite)).toEqual(before);
    // Ninguna fila quedó huérfana.
    expect(rows(sqlite, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('las columnas que ya existían conservan su contenido', async () => {
    const { sqlite, snapshot, dump } = await migrateOldBase();
    for (const table of DATA_TABLES) {
      expect(dump(table)).toEqual(snapshot[table]);
    }
    const kept = rows(
      sqlite,
      `SELECT id, version, amount, currency, group_amount FROM expenses ORDER BY id`,
    );
    expect(kept).toEqual([
      ['e1', 3, 3000, 'USD', 3000],
      ['e2', 3, 3000, 'EUR', 3000],
      ['e3', 3, 3000, 'EUR', 3000],
    ]);
    expect(rows(sqlite, `SELECT deleted_at FROM expenses WHERE id = 'e3'`)).toEqual([[NOW + 5]]);
    expect(rows(sqlite, `SELECT id, amount FROM transfers`)).toEqual([['t1', 500]]);
  });

  it('copia a cada gasto y transferencia la moneda de su grupo', async () => {
    const { sqlite } = await migrateOldBase();
    expect(rows(sqlite, `SELECT id, group_currency FROM expenses ORDER BY id`)).toEqual([
      ['e1', 'USD'],
      ['e2', 'EUR'],
      ['e3', 'EUR'],
    ]);
    expect(rows(sqlite, `SELECT id, group_currency FROM transfers`)).toEqual([['t1', 'EUR']]);
  });

  it('deja sincronizadas las 9 predefinidas y pendiente todo lo demás', async () => {
    const { sqlite } = await migrateOldBase();
    expect(
      rows(
        sqlite,
        `SELECT count(*) FROM categories
         WHERE key IS NOT NULL AND synced_version = version AND server_version IS NULL`,
      ),
    ).toEqual([[9]]);
    for (const table of SYNC_TABLES) {
      const pending = rows(
        sqlite,
        `SELECT count(*) FROM ${table} WHERE synced_version <> version
           AND (${table !== 'categories' ? '1' : 'key IS NULL'})`,
      )[0]?.[0];
      const expected = rows(
        sqlite,
        `SELECT count(*) FROM ${table} WHERE ${table !== 'categories' ? '1' : 'key IS NULL'}`,
      )[0]?.[0];
      expect(pending).toBe(expected);
    }
    // Ninguna fila existente llegó al servidor.
    for (const table of SYNC_TABLES) {
      expect(
        rows(sqlite, `SELECT count(*) FROM ${table} WHERE server_version IS NOT NULL`),
      ).toEqual([[0]]);
    }
  });

  it('crea las tablas de envío, cursores y borradores, vacías', async () => {
    const { sqlite } = await migrateOldBase();
    for (const table of ['sync_outbox', 'sync_cursors', 'sync_conflicts']) {
      expect(rows(sqlite, `SELECT count(*) FROM ${table}`)).toEqual([[0]]);
    }
  });

  it('rechaza una moneda de grupo que no son tres letras mayúsculas', async () => {
    const { sqlite } = await migrateOldBase();
    expect(() =>
      sqlite.run(
        `INSERT INTO transfers (id, created_at, updated_at, group_id, from_member_id, to_member_id,
           amount, currency, group_currency, group_amount, occurred_on)
         VALUES ('t2', ?, ?, 'g2', 'm3', 'm4', 500, 'EUR', 'eur', 500, '2026-10-10')`,
        [NOW, NOW],
      ),
    ).toThrow(/CHECK/i);
  });

  it('no reconstruye ninguna tabla: el .sql solo agrega columnas, tablas e índices', () => {
    const file = readdirSync(MIGRATIONS).find((name) => name.startsWith('0004_'));
    expect(file).toBeDefined();
    const sql = readFileSync(path.join(MIGRATIONS, file as string), 'utf8');
    // Reconstruir una tabla con foreign_keys = ON podría borrar en cascada gastos y partes.
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/__new_/i);
    expect(sql).not.toMatch(/RENAME\s+TO/i);
    expect(sql).not.toMatch(/PRAGMA\s+foreign_keys/i);
    // Ningún trozo vacío entre `--> statement-breakpoint`.
    for (const chunk of sql.split('--> statement-breakpoint')) {
      expect(chunk.replace(/--.*$/gm, '').replace(/[;\s]/g, '')).not.toBe('');
    }
  });
});
