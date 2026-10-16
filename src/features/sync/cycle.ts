import type { BatchLimits, SyncNotice, SyncRemote, SyncStore } from '@/db/sync';

export interface SyncCycleOptions {
  readonly store: Pick<SyncStore, 'nextBatch' | 'applyPushResults'>;
  readonly remote: Pick<SyncRemote, 'push'>;
  /** Tamaño de cada lote de envío. Por omisión, 50 envíos y 256 KiB. */
  readonly batch?: BatchLimits;
  /** Tamaño de las páginas de descarga. Todavía sin uso: este paso solo envía. */
  readonly pullMaxRows?: number;
  /** Se llama con cada aviso en cuanto se aplica su lote, aunque un lote posterior falle. */
  readonly onNotice?: (notice: SyncNotice) => void;
  /** Tope de lotes por ciclo, por si el almacén nunca se vaciara. */
  readonly maxBatches?: number;
}

export interface SyncCycleResult {
  readonly batches: number;
  readonly sent: number;
  readonly applied: number;
  readonly rejected: number;
  readonly failed: number;
  readonly notices: SyncNotice[];
}

const DEFAULT_BATCH: BatchLimits = { count: 50, bytes: 262_144 };
const DEFAULT_MAX_BATCHES = 200;

/**
 * Un ciclo de sincronización: manda los cambios pendientes lote por lote hasta vaciar la cola.
 * Cada lote se aplica antes de pedir el siguiente. Si el servidor no contesta, el error sale tal
 * cual: los envíos sin respuesta siguen guardados y el próximo ciclo los repite con el mismo id.
 * (La descarga se suma en el paso siguiente.)
 */
export async function runSyncCycle({
  store,
  remote,
  batch = DEFAULT_BATCH,
  onNotice,
  maxBatches = DEFAULT_MAX_BATCHES,
}: SyncCycleOptions): Promise<SyncCycleResult> {
  const result = { batches: 0, sent: 0, applied: 0, rejected: 0, failed: 0 };
  const notices: SyncNotice[] = [];

  while (result.batches < maxBatches) {
    const mutations = store.nextBatch(batch);
    if (mutations.length === 0) {
      break;
    }
    const responses = await remote.push(mutations);
    const batchNotices = store.applyPushResults(responses);

    result.batches += 1;
    result.sent += mutations.length;
    for (const response of responses) {
      if (response.status === 'applied') {
        result.applied += 1;
      } else if (response.status === 'rejected') {
        result.rejected += 1;
      } else {
        result.failed += 1;
      }
    }
    for (const notice of batchNotices) {
      notices.push(notice);
      onNotice?.(notice);
    }
  }
  return { ...result, notices };
}
