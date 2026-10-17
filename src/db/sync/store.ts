import { logger } from '@/lib/logger';

import type { ChangeBus } from '../changes';
import type { AppDatabase } from '../repositories/types';
import { discardConflict, getConflict, listConflicts, type ConflictDraft } from './conflicts';
import { applyPushResult, countSync, nextBatch, retryFailed } from './outbox';
import { applyGroupChanges, readCursors, writeCursor } from './pull';
import type { ApplyOutcome, BatchLimits, SyncCounts, SyncDeps, SyncNotice } from './types';
import type { Mutation, PushResult, RemoteGroupChanges } from './wire';

/**
 * Todo lo que el motor de sincronización necesita de SQLite, sin que vea SQL.
 */
export interface SyncStore {
  counts(): SyncCounts;
  /**
   * El próximo lote de envíos. Lo que ya salió sin respuesta sale primero, igual; lo demás se
   * guarda antes de devolverse. Vacío si no hay nada por subir.
   */
  nextBatch(limits: BatchLimits): Mutation[];
  /**
   * Aplica las respuestas del servidor, una por envío. Devuelve un aviso por cada cambio del
   * usuario que quedó como borrador.
   */
  applyPushResults(results: readonly PushResult[]): SyncNotice[];
  /** Hasta qué `change_seq` del servidor se descargó cada grupo (id de grupo → cursor). */
  cursors(): Record<string, number>;
  /**
   * Aplica la descarga de un grupo en una sola transacción, con su cursor: si nada quedó retenido
   * (`held`), el cursor avanza junto con las filas; si no, se reintenta en el próximo ciclo. Las
   * unidades con cambios locales pendientes se conservan.
   */
  applyRemoteGroup(changes: RemoteGroupChanges): ApplyOutcome;
  /** Devuelve los envíos apartados a la cola. Cuántos devolvió. */
  retryFailed(): number;
  listConflicts(groupId?: string): ConflictDraft[];
  getConflict(id: string): ConflictDraft | undefined;
  discardConflict(id: string): boolean;
}

export function createSyncStore(db: AppDatabase, bus: ChangeBus, deps: SyncDeps): SyncStore {
  return {
    counts: () => countSync(db),

    nextBatch: (limits) => nextBatch(db, limits, deps),

    applyPushResults(results) {
      const notices: SyncNotice[] = [];
      // Un solo aviso al bus por todo el lote de respuestas.
      bus.batch(() => {
        for (const result of results) {
          const effect = applyPushResult(db, result, deps);
          if (effect) {
            notices.push(effect.notice);
            bus.emit({ source: 'sync', tables: effect.tables, groupIds: [effect.groupId] });
          }
        }
      });
      return notices;
    },

    cursors: () => readCursors(db),

    applyRemoteGroup(changes) {
      let result: ReturnType<typeof applyGroupChanges>;
      try {
        result = db.transaction((tx) => {
          const now = deps.now();
          const applied = applyGroupChanges(tx, changes, now);
          // El cursor va en la misma transacción que las filas.
          if (!applied.held) {
            writeCursor(tx, changes.id, changes.cursor, now);
          }
          return applied;
        });
      } catch (error) {
        // Nada de este grupo quedó a medias: se reintenta en el próximo ciclo.
        logger.error('No se pudo aplicar la descarga de un grupo', error);
        return { applied: 0, skipped: 0, held: true };
      }
      if (result.applied > 0) {
        bus.emit({ source: 'sync', tables: result.tables, groupIds: [changes.id] });
      }
      return { applied: result.applied, skipped: result.skipped, held: result.held };
    },

    retryFailed: () => retryFailed(db),

    listConflicts: (groupId) => listConflicts(db, groupId),
    getConflict: (id) => getConflict(db, id),
    discardConflict: (id) => discardConflict(db, id),
  };
}
