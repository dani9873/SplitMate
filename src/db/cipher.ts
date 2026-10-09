import { sql } from 'drizzle-orm';

import type { AppDatabase } from './repositories';

/** Versión de SQLCipher de la base abierta, o `null` si no está cifrada. */
export function readCipherVersion(db: AppDatabase): string | null {
  try {
    const [row] = db.all<unknown>(sql`PRAGMA cipher_version`);
    const value = Array.isArray(row)
      ? row[0]
      : (row as { cipher_version?: unknown } | undefined)?.cipher_version;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
