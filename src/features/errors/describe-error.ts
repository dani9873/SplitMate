import type { TFunction } from 'i18next';

import { RepositoryError } from '@/db/repositories';
import { DomainError } from '@/domain';
import { logger } from '@/lib/logger';

/**
 * Mensaje traducido para un error de escritura. Los errores de reglas tienen un código
 * estable; cualquier otro se registra en el log y se muestra con un texto genérico.
 */
export function describeError(error: unknown, t: TFunction): string {
  if (error instanceof RepositoryError) {
    return t(`errors.repository.${error.code}`);
  }
  if (error instanceof DomainError) {
    return t(`errors.domain.${error.code}`);
  }
  logger.error('Error inesperado al guardar', error);
  return t('errors.unknown');
}
