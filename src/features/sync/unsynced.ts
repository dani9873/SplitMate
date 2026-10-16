import type { SyncStatus } from './status';

/**
 * Cuánto de lo que hay en este teléfono no está en la nube: cambios por subir, apartados que el
 * servidor no aceptó y borradores por revisar. Es lo que se perdería al borrar los datos del
 * teléfono. `held` (descarga retenida) y `lastError` no cuentan: ahí los datos ya están en la nube.
 */
export function unsyncedCount(
  status: Pick<SyncStatus, 'pending' | 'failed' | 'conflicts'>,
): number {
  return status.pending + status.failed + status.conflicts;
}
