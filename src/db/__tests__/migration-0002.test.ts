/// <reference types="node" />
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs from 'sql.js';

import { schema } from '../schema';

const MIGRATIONS = path.join(__dirname, '..', 'migrations');

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

describe('migración 0002 sobre una base con datos', () => {
  it('agrega las columnas nuevas sin tocar los datos existentes', async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    sqlite.run('PRAGMA foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    const previous = migrationsUpTo(2);
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
    sqlite.run(
      `INSERT INTO group_members (id, created_at, updated_at, group_id, user_id, display_name)
       VALUES ('m1', ?, ?, 'g1', 'u1', 'Ana')`,
      [now, now],
    );
    sqlite.run(
      `INSERT INTO expenses (id, created_at, updated_at, group_id, kind, title, amount, currency,
         group_amount, split_method, occurred_on)
       VALUES ('e1', ?, ?, 'g1', 'expense', 'Cena', 1000, 'USD', 1000, 'equal', '2026-10-09')`,
      [now, now],
    );

    migrate(db, { migrationsFolder: MIGRATIONS });

    const rows = (sql: string) => sqlite.exec(sql)[0]?.values ?? [];
    expect(rows(`SELECT id, name, emoji, color, archived_at, version FROM groups`)).toEqual([
      ['g1', 'Viaje', null, 'teal', null, 1],
    ]);
    expect(rows(`SELECT id, user_id FROM group_members`)).toEqual([['m1', 'u1']]);
    expect(rows(`SELECT id, amount FROM expenses`)).toEqual([['e1', 1000]]);
    expect(rows(`SELECT count(*) FROM categories`)).toEqual([[9]]);
    expect(rows(`SELECT count(*) FROM local_settings`)).toEqual([[0]]);
  });
});
