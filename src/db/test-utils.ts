/// <reference types="node" />
// Tipos de Node solo para este archivo de pruebas: corre en Jest, nunca en la app.
import path from 'node:path';

import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs, { type Database } from 'sql.js';

import { createIdGenerator } from '@/lib/ids';

import { createChangeBus } from './changes';
import { createRepositories } from './repositories';
import { schema } from './schema';

/**
 * Base SQLite real en memoria para pruebas, con las mismas migraciones que la app.
 * Usa sql.js (WebAssembly): no requiere compilar nada nativo en Windows ni en CI.
 * Solo para Jest: la app usa expo-sqlite con SQLCipher.
 */
export async function createTestDatabase() {
  const SQL = await initSqlJs();
  const sqlite: Database = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
  return { db, sqlite };
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>['db'];

/**
 * Repositorios sobre una base de prueba, con reloj e ids deterministas y el bus de cambios
 * expuesto para observar las emisiones.
 */
export async function createTestRepositories() {
  const { db, sqlite } = await createTestDatabase();
  let time = 1_760_000_000_000;
  const now = () => (time += 1);
  const newId = createIdGenerator({ now, randomBytes: (n) => new Uint8Array(n).fill(7) });
  const bus = createChangeBus();
  const repos = createRepositories(db, { now, newId }, { bus });
  return { db, sqlite, repos, bus };
}

export type TestRepositories = Awaited<ReturnType<typeof createTestRepositories>>;

/** Grupo de prueba en USD con Ana (usuario local, "yo"), Beto y Carla. */
export function createTestGroup(
  { repos }: TestRepositories,
  options: { currency?: string; names?: readonly string[] } = {},
) {
  const [first = 'Ana', ...others] = options.names ?? ['Ana', 'Beto', 'Carla'];
  const me = repos.profile.ensure(first);
  const group = repos.groups.create({
    name: 'Viaje',
    currency: options.currency ?? 'USD',
    createdBy: me.id,
    members: [
      { displayName: first, userId: me.id },
      ...others.map((displayName) => ({ displayName })),
    ],
  });
  const members = repos.members.listByGroup(group.id);
  return { group, members, ids: members.map((m) => m.id) };
}
