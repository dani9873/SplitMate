import type { z } from 'zod';

import type { Money } from '@/domain';

export type RepositoryErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'MEMBER_HAS_BALANCE'
  | 'LAST_MEMBER'
  | 'CURRENCY_LOCKED'
  | 'GROUP_ARCHIVED';

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

/** Datos para explicar el error en la UI. */
export interface RepositoryErrorDetails {
  /** Saldo del miembro que no se puede quitar. */
  readonly balance?: Money;
}

/**
 * Error de acceso a datos con un `code` estable para la UI:
 * - `NOT_FOUND`: el registro no existe o está borrado.
 * - `CONFLICT`: otro cambio modificó el registro; la `version` esperada ya no coincide.
 * - `VALIDATION`: la entrada no cumple el esquema; `issues` indica qué campos fallaron.
 * - `MEMBER_HAS_BALANCE`: no se quita a un miembro con saldo; `details.balance` lo indica.
 * - `LAST_MEMBER`: un grupo no se queda sin miembros.
 * - `CURRENCY_LOCKED`: la moneda del grupo no cambia cuando ya tiene movimientos.
 * - `GROUP_ARCHIVED`: un grupo archivado es de solo lectura.
 */
export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
    readonly details: RepositoryErrorDetails = {},
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

/** Incumplimiento de una regla de negocio con su código propio. */
export const ruleViolation = (
  code: Exclude<RepositoryErrorCode, 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION'>,
  message: string,
  details: RepositoryErrorDetails = {},
) => new RepositoryError(code, message, [], details);

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
