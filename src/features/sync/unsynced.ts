import type { SyncStatus } from './status';

/**
 * Cuánto de lo que hay en este teléfono no está en la nube: cambios por subir (también los de grupos
 * sin acceso), apartados que el servidor no aceptó y borradores por revisar. Es lo que se perdería al borrar los datos del
 * teléfono. `held` (descarga retenida) y `lastError` no cuentan: ahí los datos ya están en la nube.
 */
export function unsyncedCount(
  status: Pick<SyncStatus, 'pending' | 'failed' | 'conflicts' | 'lost'>,
): number {
  return status.pending + status.failed + status.conflicts + status.lost;
}

/**
 * Todo lo que subía ya subió y solo quedan borradores por revisar. Sincronizar no los resuelve:
 * hay que revisarlos o descartarlos.
 */
export function onlyDrafts(
  status: Pick<SyncStatus, 'pending' | 'failed' | 'conflicts' | 'lost'>,
): boolean {
  return status.conflicts > 0 && status.pending === 0 && status.failed === 0 && status.lost === 0;
}
