import type { BatchLimits, SyncNotice, SyncRemote, SyncStore } from '@/db/sync';

export interface SyncCycleOptions {
  readonly store: Pick<SyncStore, 'nextBatch' | 'applyPushResults' | 'pullCursors' | 'applyPull'>;
  readonly remote: Pick<SyncRemote, 'push' | 'pull'>;
  /** Tamaño de cada lote de envío. Por omisión, 50 envíos y 256 KiB. */
  readonly batch?: BatchLimits;
  /** Filas por página de descarga. Por omisión, 1000. */
  readonly pullMaxRows?: number;
  /** Se llama con cada aviso en cuanto se aplica su lote, aunque un lote posterior falle. */
  readonly onNotice?: (notice: SyncNotice) => void;
  /** Tope de lotes por ciclo, por si el almacén nunca se vaciara. */
  readonly maxBatches?: number;
  /** Tope de páginas de descarga por ciclo, por si el servidor siempre dijera que hay más. */
  readonly maxPages?: number;
}

export interface SyncCycleResult {
  readonly batches: number;
  readonly sent: number;
  readonly applied: number;
  readonly rejected: number;
  readonly failed: number;
  /** Páginas de descarga pedidas (la última, vacía o sin más, también cuenta). */
  readonly pages: number;
  /** Unidades que cambiaron en la base local por la descarga. */
  readonly pulled: number;
  /** Unidades con cambios locales pendientes que la descarga dejó como estaban. */
  readonly skipped: number;
  /** Grupos cuyo cursor no avanzó porque algo no se pudo aplicar. */
  readonly held: number;
  /** Grupos que el servidor dijo que la cuenta ya no ve (quedaron de solo lectura). */
  readonly lost: number;
  readonly notices: SyncNotice[];
}

const DEFAULT_BATCH: BatchLimits = { count: 50, bytes: 262_144 };
const DEFAULT_MAX_BATCHES = 200;
const DEFAULT_PULL_MAX_ROWS = 1000;
const DEFAULT_MAX_PAGES = 50;

/**
 * Un ciclo de sincronización: manda los cambios pendientes lote por lote hasta vaciar la cola y
 * después descarga lo nuevo página por página. Cada lote o grupo se aplica antes de pedir el
 * siguiente. Si el servidor no contesta, el error sale tal cual: los envíos sin respuesta siguen
 * guardados y el próximo ciclo los repite con el mismo id, y los cursores solo avanzan con lo que
 * ya se aplicó.
 */
export async function runSyncCycle({
  store,
  remote,
  batch = DEFAULT_BATCH,
  pullMaxRows = DEFAULT_PULL_MAX_ROWS,
  onNotice,
  maxBatches = DEFAULT_MAX_BATCHES,
  maxPages = DEFAULT_MAX_PAGES,
}: SyncCycleOptions): Promise<SyncCycleResult> {
  const result = {
    batches: 0,
    sent: 0,
    applied: 0,
    rejected: 0,
    failed: 0,
    pages: 0,
    pulled: 0,
    skipped: 0,
    held: 0,
    lost: 0,
  };
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

  // Un grupo retenido conserva su cursor en la base (se reintenta en el próximo ciclo), pero dentro
  // de este ciclo se pide desde donde llegó: así no se queda pidiendo siempre el mismo y los demás
  // grupos avanzan. Siempre se mandan los cursores de todos los grupos del teléfono: el servidor
  // descarga desde 0 el que falte.
  const heldCursors: Record<string, number> = {};
  while (result.pages < maxPages) {
    const page = await remote.pull({ ...store.pullCursors(), ...heldCursors }, pullMaxRows);
    result.pages += 1;
    const outcome = store.applyPull(page);
    result.pulled += outcome.applied;
    result.skipped += outcome.skipped;
    result.lost += outcome.lost.length;
    let unsafe = false;
    for (const held of outcome.held) {
      result.held += 1;
      if (held.cursor === null) {
        // Sin un cursor seguro (se descartó una descarga por páginas): hasta el próximo ciclo.
        unsafe = true;
      } else {
        heldCursors[held.id] = held.cursor;
      }
    }
    if ((!page.hasMore && !outcome.more) || unsafe) {
      break;
    }
  }
  return { ...result, notices };
}
