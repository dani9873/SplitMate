import type { z } from 'zod';

export type RepositoryErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION';

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Error de acceso a datos con un `code` estable para la UI:
 * - `NOT_FOUND`: el registro no existe o está borrado.
 * - `CONFLICT`: otro cambio modificó el registro; la `version` esperada ya no coincide.
 * - `VALIDATION`: la entrada no cumple el esquema; `issues` indica qué campos fallaron.
 */
export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export const notFound = (what: string) => new RepositoryError('NOT_FOUND', `${what} no existe`);

export const conflict = (what: string) =>
  new RepositoryError('CONFLICT', `${what} cambió desde la última lectura`);

export const invalid = (message: string, issues: readonly ValidationIssue[] = []) =>
  new RepositoryError('VALIDATION', message, issues);

/** Valida la entrada con zod y la convierte en un `RepositoryError` legible si falla. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw invalid('Entrada inválida', issues);
  }
  return result.data;
}
