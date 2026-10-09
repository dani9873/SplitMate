/// <reference types="node" />
// Tipos de Node solo para este archivo de pruebas: corre en Jest, nunca en la app.
import path from 'node:path';

import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs, { type Database } from 'sql.js';

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
