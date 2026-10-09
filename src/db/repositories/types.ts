import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { Schema } from '../schema';

/**
 * Conexión síncrona de Drizzle con el esquema de SplitMate. La app usa expo-sqlite y las
 * pruebas sql.js; ambos cumplen este tipo.
 */
export type AppDatabase = BaseSQLiteDatabase<'sync', unknown, Schema>;

/** Reloj y generador de ids, inyectables para que las pruebas sean deterministas. */
export interface RepositoryDeps {
  now(): number;
  newId(): string;
}
