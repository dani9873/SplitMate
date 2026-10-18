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
  'sync_outbox',
  'sync_cursors',
  'sync_conflicts',
  'local_settings',
] as const;

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

/** Una base de la Fase 4a: dos grupos ya sincronizados, un cambio por subir y un cursor. */
function seedPhase4aData(sqlite: Database) {
  const run = (sql: string, params: (string | number | null)[] = []) => sqlite.run(sql, params);
  run(`INSERT INTO users (id, created_at, updated_at, display_name) VALUES ('u1', ?, ?, 'Ana')`, [
    NOW,
    NOW,
  ]);
  run(`INSERT INTO local_settings (key, value, updated_at) VALUES ('profile.userId', 'u1', ?)`, [
    NOW,
  ]);
  for (const [id, name, currency] of [
    ['g1', 'Viaje', 'USD'],
    ['g2', 'Casa', 'EUR'],
  ] as const) {
    run(
      `INSERT INTO groups (id, created_at, updated_at, name, currency, created_by,
         version, synced_version, server_version)
       VALUES (?, ?, ?, ?, ?, 'u1', 2, 2, 2)`,
      [id, NOW, NOW, name, currency],
    );
  }
  for (const [id, groupId, name, synced] of [
    ['m1', 'g1', 'Ana', 1],
    ['m2', 'g1', 'Beto', 1],
    ['m3', 'g2', 'Carla', 1],
    ['m4', 'g2', 'Dani', 0],
  ] as const) {
    run(
      `INSERT INTO group_members (id, created_at, updated_at, group_id, display_name,
         version, synced_version, server_version)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, NOW, NOW, groupId, name, synced, synced === 1 ? 1 : null],
    );
  }
  run(
    `INSERT INTO expenses (id, created_at, updated_at, group_id, group_currency, kind, title, amount,
       currency, group_amount, split_method, occurred_on, version, synced_version, server_version)
     VALUES ('e1', ?, ?, 'g1', 'USD', 'expense', 'Cena', 3000, 'USD', 3000, 'equal', '2026-10-09',
       1, 1, 1)`,
    [NOW, NOW],
  );
  run(
    `INSERT INTO sync_outbox (id, entity, entity_id, group_id, base, data, created_at)
     VALUES ('o1', 'member', 'm4', 'g2', NULL, '{}', ?)`,
    [NOW],
  );
  run(`INSERT INTO sync_cursors (group_id, cursor, updated_at) VALUES ('g1', 7, ?)`, [NOW]);
}

async function migrateOldBase() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const previous = migrationsUpTo(5);
  try {
    migrate(db, { migrationsFolder: previous });
  } finally {
    rmSync(previous, { recursive: true, force: true });
  }
  seedPhase4aData(sqlite);
  const before = counts(sqlite);
  const oldColumns = Object.fromEntries(
    DATA_TABLES.map((table) => [
      table,
      rows(sqlite, `PRAGMA table_info(${table})`).map((column) => String(column[1])),
    ]),
  );
  const dump = (table: string) =>
    rows(sqlite, `SELECT ${(oldColumns[table] ?? []).join(', ')} FROM ${table} ORDER BY 1`);
  const snapshot = Object.fromEntries(DATA_TABLES.map((table) => [table, dump(table)]));
  migrate(db, { migrationsFolder: MIGRATIONS });
  return { sqlite, before, snapshot, dump };
}

describe('migración 0005 sobre una base de la Fase 4a con datos', () => {
  it('conserva todas las filas y su contenido', async () => {
    const { sqlite, before, snapshot, dump } = await migrateOldBase();
    expect(before.groups).toBe(2);
    expect(counts(sqlite)).toEqual(before);
    for (const table of DATA_TABLES) {
      expect(dump(table)).toEqual(snapshot[table]);
    }
    expect(rows(sqlite, 'PRAGMA foreign_key_check')).toEqual([]);
  });

  it('no marca nada como pendiente: las versiones sincronizadas siguen iguales', async () => {
    const { sqlite } = await migrateOldBase();
    expect(
      rows(sqlite, `SELECT id, version, synced_version, server_version FROM groups ORDER BY id`),
    ).toEqual([
      ['g1', 2, 2, 2],
      ['g2', 2, 2, 2],
    ]);
    expect(
      rows(sqlite, `SELECT id, synced_version = version FROM group_members ORDER BY id`),
    ).toEqual([
      ['m1', 1],
      ['m2', 1],
      ['m3', 1],
      ['m4', 0],
    ]);
    expect(rows(sqlite, `SELECT synced_version = version FROM expenses`)).toEqual([[1]]);
  });

  it('los usuarios existentes no son remotos y los grupos no han perdido el acceso', async () => {
    const { sqlite } = await migrateOldBase();
    expect(rows(sqlite, `SELECT id, is_remote FROM users`)).toEqual([['u1', 0]]);
    expect(rows(sqlite, `SELECT count(*) FROM groups WHERE access_lost_at IS NOT NULL`)).toEqual([
      [0],
    ]);
  });

  it('los borradores que ya había se conservan y aceptan los motivos nuevos', async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    sqlite.run('PRAGMA foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    const previous = migrationsUpTo(5);
    try {
      migrate(db, { migrationsFolder: previous });
    } finally {
      rmSync(previous, { recursive: true, force: true });
    }
    sqlite.run(
      `INSERT INTO sync_conflicts (id, entity, entity_id, group_id, reason, data, created_at)
       VALUES ('c1', 'expense', 'e1', 'g1', 'conflict', '{"title":"Cena"}', ?)`,
      [NOW],
    );
    migrate(db, { migrationsFolder: MIGRATIONS });
    expect(rows(sqlite, `SELECT id, reason, quota, data FROM sync_conflicts`)).toEqual([
      ['c1', 'conflict', null, '{"title":"Cena"}'],
    ]);
    const insert = (id: string, reason: string, quota: string | null) =>
      sqlite.run(
        `INSERT INTO sync_conflicts (id, entity, entity_id, group_id, reason, quota, data, created_at)
         VALUES (?, 'member', 'm9', 'g1', ?, ?, '{}', ?)`,
        [id, reason, quota, NOW],
      );
    insert('c2', 'member_linked', null);
    insert('c3', 'quota', 'members');
    expect(() => insert('c4', 'quota', 'otra')).toThrow(/CHECK/i);
    expect(() => insert('c5', 'desconocido', null)).toThrow(/CHECK/i);
    expect(rows(sqlite, `SELECT count(*) FROM sync_conflicts`)).toEqual([[3]]);
  });

  it('crea las tablas nuevas vacías', async () => {
    const { sqlite } = await migrateOldBase();
    for (const table of ['group_access', 'invitation_links', 'sync_pull_pages']) {
      expect(rows(sqlite, `SELECT count(*) FROM ${table}`)).toEqual([[0]]);
    }
  });

  it('el cursor que ya existía queda sin descarga en curso', async () => {
    const { sqlite } = await migrateOldBase();
    expect(
      rows(sqlite, `SELECT group_id, cursor, hw, after_t, after_id, staged FROM sync_cursors`),
    ).toEqual([['g1', 7, null, null, null, 0]]);
  });

  it('una cuenta ajena entra como fila mínima remota y respeta las claves foráneas', async () => {
    const { sqlite } = await migrateOldBase();
    sqlite.run(
      `INSERT INTO users (id, created_at, updated_at, display_name, is_remote)
       VALUES ('u2', ?, ?, '?', 1)`,
      [NOW, NOW],
    );
    // Un grupo creado por esa cuenta y su acceso se guardan sin romper ninguna FK.
    sqlite.run(
      `INSERT INTO groups (id, created_at, updated_at, name, currency, created_by)
       VALUES ('g3', ?, ?, 'Ajeno', 'USD', 'u2')`,
      [NOW, NOW],
    );
    sqlite.run(
      `INSERT INTO group_access (id, group_id, user_id, role, invitation_id, created_at,
         updated_at, deleted_at, version)
       VALUES ('a1', 'g3', 'u2', 'owner', NULL, ?, ?, NULL, 3)`,
      [NOW, NOW],
    );
    expect(rows(sqlite, 'PRAGMA foreign_key_check')).toEqual([]);
    // Sin la cuenta, la FK lo impide.
    expect(() =>
      sqlite.run(
        `INSERT INTO group_access (id, group_id, user_id, role, created_at, updated_at, version)
         VALUES ('a2', 'g3', 'u9', 'member', ?, ?, 1)`,
        [NOW, NOW],
      ),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('group_access: una fila por cuenta y grupo, rol válido y versión positiva', async () => {
    const { sqlite } = await migrateOldBase();
    const insert = (id: string, role: string, version = 1, user = 'u1') =>
      sqlite.run(
        `INSERT INTO group_access (id, group_id, user_id, role, created_at, updated_at, version)
         VALUES (?, 'g1', ?, ?, ?, ?, ?)`,
        [id, user, role, NOW, NOW, version],
      );
    insert('a1', 'owner');
    expect(() => insert('a2', 'member')).toThrow(/UNIQUE/i);
    sqlite.run(`DELETE FROM group_access`);
    expect(() => insert('a3', 'admin')).toThrow(/CHECK/i);
    expect(() => insert('a4', 'member', 0)).toThrow(/CHECK/i);
  });

  it('invitation_links: el token se guarda por grupo, pero es único por invitación', async () => {
    const { sqlite } = await migrateOldBase();
    const insert = (id: string, token: string) =>
      sqlite.run(
        `INSERT INTO invitation_links (id, group_id, token, expires_at, max_uses, created_at)
         VALUES (?, 'g1', ?, ?, 10, ?)`,
        [id, token, NOW + 1000, NOW],
      );
    insert('i1', 'x'.repeat(43));
    expect(() => insert('i1', 'y'.repeat(43))).toThrow(/UNIQUE|PRIMARY/i);
    expect(() => insert('i2', 'corto')).toThrow(/CHECK/i);
  });

  it('sync_pull_pages: una página por grupo y número', async () => {
    const { sqlite } = await migrateOldBase();
    const insert = (page: number) =>
      sqlite.run(
        `INSERT INTO sync_pull_pages (group_id, page, rows, created_at) VALUES ('g1', ?, '[]', ?)`,
        [page, NOW],
      );
    insert(1);
    insert(2);
    expect(() => insert(1)).toThrow(/UNIQUE|PRIMARY/i);
  });

  it('solo reconstruye sync_conflicts (sin claves foráneas) y no usa PRAGMA', () => {
    const file = readdirSync(MIGRATIONS).find((name) => name.startsWith('0005_'));
    expect(file).toBeDefined();
    const sql = readFileSync(path.join(MIGRATIONS, file as string), 'utf8');
    // Reconstruir una tabla con claves foráneas y foreign_keys = ON podría borrar en cascada.
    expect(sql.match(/DROP\s+TABLE\s+`?(\w+)`?/gi)).toEqual(['DROP TABLE `sync_conflicts`']);
    expect(sql.match(/RENAME\s+TO\s+`?(\w+)`?/gi)).toEqual(['RENAME TO `sync_conflicts`']);
    expect(sql).not.toMatch(/PRAGMA\s+foreign_keys/i);
    for (const chunk of sql.split('--> statement-breakpoint')) {
      expect(chunk.replace(/--.*$/gm, '').replace(/[;\s]/g, '')).not.toBe('');
    }
  });
});
