import type { Database } from 'sql.js';

import { createTestDatabase } from '../test-utils';

const NOW = 1_760_000_000_000;
const sync = [NOW, NOW] as const;

/** Inserta un usuario, un grupo con dos miembros y un gasto, con SQL directo. */
function seedBase(sqlite: Database) {
  sqlite.run(
    `INSERT INTO users (id, created_at, updated_at, display_name) VALUES ('u1', ?, ?, 'Ana')`,
    [...sync],
  );
  sqlite.run(
    `INSERT INTO groups (id, created_at, updated_at, name, currency, created_by)
     VALUES ('g1', ?, ?, 'Viaje', 'USD', 'u1')`,
    [...sync],
  );
  for (const [id, name] of [
    ['m1', 'Ana'],
    ['m2', 'Beto'],
  ] as const) {
    sqlite.run(
      `INSERT INTO group_members (id, created_at, updated_at, group_id, display_name)
       VALUES (?, ?, ?, 'g1', ?)`,
      [id, ...sync, name],
    );
  }
  sqlite.run(
    `INSERT INTO expenses (id, created_at, updated_at, group_id, kind, title, amount, currency,
       group_amount, split_method, occurred_on)
     VALUES ('e1', ?, ?, 'g1', 'expense', 'Cena', 1000, 'USD', 1000, 'equal', '2026-10-09')`,
    [...sync],
  );
}

const insertPayer = (sqlite: Database, id: string, member = 'm1') =>
  sqlite.run(
    `INSERT INTO expense_payers (id, created_at, updated_at, expense_id, member_id, amount, group_amount)
     VALUES (?, ?, ?, 'e1', ?, 1000, 1000)`,
    [id, ...sync, member],
  );

const tableNames = (sqlite: Database) =>
  (
    sqlite.exec(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name`,
    )[0]?.values ?? []
  ).flat();

describe('esquema y migraciones', () => {
  it('crea todas las tablas', async () => {
    const { sqlite } = await createTestDatabase();
    expect(tableNames(sqlite)).toEqual([
      'categories',
      'expense_payers',
      'expense_splits',
      'expenses',
      'group_members',
      'groups',
      'local_settings',
      'transfers',
      'users',
    ]);
  });

  it('todas las tablas sincronizables tienen las columnas de sincronización', async () => {
    const { sqlite } = await createTestDatabase();
    // local_settings guarda datos de este dispositivo y nunca se sincroniza.
    for (const table of tableNames(sqlite).filter((name) => name !== 'local_settings')) {
      const columns = (sqlite.exec(`PRAGMA table_info(${String(table)})`)[0]?.values ?? []).map(
        (row) => row[1],
      );
      expect(columns).toEqual(
        expect.arrayContaining(['id', 'created_at', 'updated_at', 'deleted_at', 'version']),
      );
    }
  });

  it('siembra las categorías predefinidas con su clave de traducción', async () => {
    const { sqlite } = await createTestDatabase();
    const keys = (
      sqlite.exec(`SELECT key FROM categories WHERE group_id IS NULL ORDER BY key`)[0]?.values ?? []
    ).flat();
    expect(keys).toEqual([
      'entertainment',
      'food',
      'groceries',
      'health',
      'lodging',
      'other',
      'shopping',
      'transport',
      'utilities',
    ]);
  });

  it('rechaza monedas que no son tres letras mayúsculas', async () => {
    const { sqlite } = await createTestDatabase();
    seedBase(sqlite);
    expect(() =>
      sqlite.run(
        `INSERT INTO groups (id, created_at, updated_at, name, currency, created_by)
         VALUES ('g2', ?, ?, 'Otro', 'usd', 'u1')`,
        [...sync],
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rechaza miembros de un grupo inexistente', async () => {
    const { sqlite } = await createTestDatabase();
    seedBase(sqlite);
    expect(() =>
      sqlite.run(
        `INSERT INTO group_members (id, created_at, updated_at, group_id, display_name)
         VALUES ('m9', ?, ?, 'no-existe', 'Nadie')`,
        [...sync],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rechaza montos de gasto no positivos', async () => {
    const { sqlite } = await createTestDatabase();
    seedBase(sqlite);
    expect(() =>
      sqlite.run(
        `INSERT INTO expenses (id, created_at, updated_at, group_id, kind, title, amount, currency,
           group_amount, split_method, occurred_on)
         VALUES ('e2', ?, ?, 'g1', 'expense', 'Nada', 0, 'USD', 0, 'equal', '2026-10-09')`,
        [...sync],
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it('un miembro paga una sola vez por gasto, salvo que el registro anterior esté borrado', async () => {
    const { sqlite } = await createTestDatabase();
    seedBase(sqlite);
    insertPayer(sqlite, 'p1');
    expect(() => insertPayer(sqlite, 'p2')).toThrow(/UNIQUE constraint failed/);
    sqlite.run(`UPDATE expense_payers SET deleted_at = ? WHERE id = 'p1'`, [NOW]);
    expect(() => insertPayer(sqlite, 'p3')).not.toThrow();
  });

  it('limita el color del grupo a la paleta y el emoji a un largo razonable', async () => {
    const { sqlite } = await createTestDatabase();
    seedBase(sqlite);
    const group = (sqlite.exec(`SELECT color, emoji, archived_at FROM groups WHERE id = 'g1'`)[0]
      ?.values ?? [])[0];
    expect(group).toEqual(['teal', null, null]);
    expect(() =>
      sqlite.run(`UPDATE groups SET color = 'plum', emoji = '🏖️' WHERE id = 'g1'`),
    ).not.toThrow();
    expect(() => sqlite.run(`UPDATE groups SET color = '#FF0000' WHERE id = 'g1'`)).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => sqlite.run(`UPDATE groups SET emoji = '' WHERE id = 'g1'`)).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      sqlite.run(`UPDATE groups SET emoji = ? WHERE id = 'g1'`, ['x'.repeat(17)]),
    ).toThrow(/CHECK constraint failed/);
  });

  it('un usuario es a lo sumo un miembro activo de cada grupo', async () => {
    const { sqlite } = await createTestDatabase();
    seedBase(sqlite);
    sqlite.run(`UPDATE group_members SET user_id = 'u1' WHERE id = 'm1'`);
    expect(() => sqlite.run(`UPDATE group_members SET user_id = 'u1' WHERE id = 'm2'`)).toThrow(
      /UNIQUE constraint failed/,
    );
    sqlite.run(`UPDATE group_members SET deleted_at = ? WHERE id = 'm1'`, [NOW]);
    expect(() =>
      sqlite.run(`UPDATE group_members SET user_id = 'u1' WHERE id = 'm2'`),
    ).not.toThrow();
  });

  it('rechaza transferencias a uno mismo', async () => {
    const { sqlite } = await createTestDatabase();
    seedBase(sqlite);
    expect(() =>
      sqlite.run(
        `INSERT INTO transfers (id, created_at, updated_at, group_id, from_member_id, to_member_id,
           amount, currency, group_amount, occurred_on)
         VALUES ('t1', ?, ?, 'g1', 'm1', 'm1', 500, 'USD', 500, '2026-10-09')`,
        [...sync],
      ),
    ).toThrow(/CHECK constraint failed/);
  });
});
