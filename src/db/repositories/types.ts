import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { ChangeSource, TableName } from '../changes';
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

/** Lo que comparte cada repositorio: la base, sus dependencias y el aviso de cambios. */
export interface RepositoryContext {
  readonly db: AppDatabase;
  readonly deps: RepositoryDeps;
  readonly source: ChangeSource;
  /**
   * Avisa en el bus que se confirmó una escritura. Se llama después de la transacción, nunca
   * dentro: si la transacción falla, no hay aviso.
   */
  notify(tables: readonly TableName[], groupIds: readonly string[] | null): void;
}
