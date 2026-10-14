/// <reference types="node" />
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs from 'sql.js';

import { OTHER_CATEGORY_ID } from '../repositories';
import { schema } from '../schema';

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const FOOD_CATEGORY_ID = '0199c82c-c000-7000-8000-000000000001';

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

describe('migración 0003 sobre una base con datos', () => {
  it('pasa a Otros los gastos sin categoría y no toca los que ya tienen una', async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    sqlite.run('PRAGMA foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    const previous = migrationsUpTo(3);
    try {
      migrate(db, { migrationsFolder: previous });
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }

    const now = 1_760_000_000_000;
    sqlite.run(
      `INSERT INTO users (id, created_at, updated_at, display_name) VALUES ('u1', ?, ?, 'Ana')`,
      [now, now],
    );
    sqlite.run(
      `INSERT INTO groups (id, created_at, updated_at, name, currency, created_by)
       VALUES ('g1', ?, ?, 'Viaje', 'USD', 'u1')`,
      [now, now],
    );
    const insertExpense = (id: string, kind: string, categoryId: string | null) =>
      sqlite.run(
        `INSERT INTO expenses (id, created_at, updated_at, group_id, kind, title, amount, currency,
           group_amount, split_method, category_id, occurred_on)
         VALUES (?, ?, ?, 'g1', ?, 'Movimiento', 1000, 'USD', 1000, 'equal', ?, '2026-10-09')`,
        [id, now, now, kind, categoryId],
      );
    insertExpense('sin-categoria', 'expense', null);
    insertExpense('ingreso-sin-categoria', 'income', null);
    insertExpense('comida', 'expense', FOOD_CATEGORY_ID);

    migrate(db, { migrationsFolder: MIGRATIONS });

    const rows = (sql: string) => sqlite.exec(sql)[0]?.values ?? [];
    expect(rows(`SELECT id, category_id FROM expenses ORDER BY id`)).toEqual([
      ['comida', FOOD_CATEGORY_ID],
      ['ingreso-sin-categoria', OTHER_CATEGORY_ID],
      ['sin-categoria', OTHER_CATEGORY_ID],
    ]);
  });
});
