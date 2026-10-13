import { DatabaseSetupError } from './errors';

/** Las migraciones como las empaqueta drizzle-kit para expo-sqlite (`migrations/migrations.js`). */
export interface BundledMigrations {
  readonly journal: { readonly entries: readonly { readonly idx: number; readonly tag: string }[] };
  readonly migrations: Readonly<Record<string, string>>;
}

/** El separador con el que el migrador de Drizzle parte cada archivo en sentencias. */
const BREAKPOINT = '--> statement-breakpoint';

/** Verdadero si el texto tiene algo que SQLite pueda preparar: no solo espacios, comentarios o `;`. */
export function hasSql(text: string): boolean {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  return withoutComments.replace(/[\s;]/g, '').length > 0;
}

/**
 * Revisa, antes de migrar, que cada trozo de cada migración tenga SQL. Con un trozo sin SQL (por
 * ejemplo, la plantilla de `drizzle-kit generate --custom`), SQLite no prepara nada y expo-sqlite
 * ejecuta un statement nulo: la app se cierra sin aviso (SIGSEGV en `sqlite3_clear_bindings`).
 * Aquí falla con un error controlado: la app muestra la pantalla de error de la base y no se
 * registra la migración.
 */
export function assertMigrationsHaveSql(bundle: BundledMigrations): void {
  for (const entry of bundle.journal.entries) {
    const text = bundle.migrations[`m${String(entry.idx).padStart(4, '0')}`];
    if (text === undefined) {
      throw new DatabaseSetupError('MIGRATION_INVALID', `Falta la migración ${entry.tag}`);
    }
    text.split(BREAKPOINT).forEach((chunk, index) => {
      if (!hasSql(chunk)) {
        throw new DatabaseSetupError(
          'MIGRATION_INVALID',
          `La migración ${entry.tag} tiene un trozo sin SQL (trozo ${index + 1})`,
        );
      }
    });
  }
}
