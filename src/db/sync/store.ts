import type { ChangeBus } from '../changes';
import type { AppDatabase } from '../repositories/types';
import { discardConflict, getConflict, listConflicts, type ConflictDraft } from './conflicts';
import { applyPushResult, countSync, nextBatch, retryFailed } from './outbox';
import type { BatchLimits, SyncCounts, SyncDeps, SyncNotice } from './types';
import type { Mutation, PushResult } from './wire';

/**
 * Todo lo que el motor de sincronización necesita de SQLite, sin que vea SQL. La descarga
 * (`cursors`, `applyRemoteGroup`) se suma en el paso siguiente de la Fase 4a.
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

    retryFailed: () => retryFailed(db),

    listConflicts: (groupId) => listConflicts(db, groupId),
    getConflict: (id) => getConflict(db, id),
    discardConflict: (id) => discardConflict(db, id),
  };
}
