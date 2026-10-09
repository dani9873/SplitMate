export type DatabaseSetupErrorCode = 'KEY_INVALID' | 'ENCRYPTION_UNAVAILABLE';

/** Fallo al preparar la base local, distinto de un error de migración de SQLite. */
export class DatabaseSetupError extends Error {
  constructor(
    readonly code: DatabaseSetupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DatabaseSetupError';
  }
}
