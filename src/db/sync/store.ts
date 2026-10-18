import { logger } from '@/lib/logger';

import type { ChangeBus, TableName } from '../changes';
import type { AppDatabase } from '../repositories/types';
import { discardConflict, getConflict, listConflicts, type ConflictDraft } from './conflicts';
import { applyPushResult, countSync, nextBatch, retryFailed } from './outbox';
import {
  applyGroupChanges,
  applyPulledGroup,
  clearStaging,
  finishStagedGroup,
  markGroupsLost,
  readCursors,
  readPullCursors,
  stagedGroups,
  writeCursor,
  type PulledResult,
} from './pull';
import type {
  ApplyOutcome,
  BatchLimits,
  PullOutcome,
  SyncCounts,
  SyncDeps,
  SyncNotice,
} from './types';
import type { Mutation, PullCursor, PullResponse, PushResult, RemoteGroupChanges } from './wire';

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
  /** Hasta qué `change_seq` del servidor se descargó (y aplicó) cada grupo (id de grupo → cursor). */
  cursors(): Record<string, number>;
  /**
   * Lo que hay que mandar a `sync_pull_v2`: el cursor de **todos** los grupos del teléfono (menos
   * los que perdieron el acceso), como entero o, en una descarga por páginas, como objeto.
   */
  pullCursors(): Record<string, PullCursor>;
  /**
   * Aplica una respuesta de `sync_pull_v2`: cada grupo en su transacción, junto con su cursor; las
   * páginas parciales se guardan sin aplicar y se aplican juntas al final; los grupos perdidos
   * quedan de solo lectura.
   */
  applyPull(response: PullResponse): PullOutcome;
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

    pullCursors: () => readPullCursors(db),

    applyPull(response) {
      const now = deps.now();
      let applied = 0;
      let skipped = 0;
      const held: { id: string; cursor: number | null }[] = [];
      const present = new Set<string>();

      const run = (
        id: string,
        heldCursor: number | null,
        work: (tx: AppDatabase) => PulledResult,
      ) => {
        let result: PulledResult;
        try {
          result = db.transaction((tx) => work(tx));
        } catch (error) {
          // Nada de este grupo quedó a medias. Lo guardado de la descarga por páginas se descarta
          // y se baja de nuevo en el próximo ciclo.
          logger.error('No se pudo aplicar la descarga de un grupo', error);
          try {
            db.transaction((tx) => clearStaging(tx, id));
          } catch (clearError) {
            logger.error('No se pudo descartar la descarga por páginas', clearError);
          }
          held.push({ id, cursor: heldCursor });
          return;
        }
        applied += result.applied;
        skipped += result.skipped;
        if (result.held) {
          held.push({ id, cursor: heldCursor });
        }
        if (result.applied > 0) {
          bus.emit({ source: 'sync', tables: result.tables as TableName[], groupIds: [id] });
        }
      };

      for (const group of response.groups) {
        present.add(group.id);
        run(group.id, group.cursor, (tx) => applyPulledGroup(tx, group, now));
      }
      // La ronda extra de un grupo grande que no trajo nada de él: se aplica lo guardado.
      for (const { id, hw } of stagedGroups(db)) {
        if (!present.has(id)) {
          run(id, hw, (tx) => finishStagedGroup(tx, id, now));
        }
      }

      const lost = markGroupsLost(db, response.lost, now);
      if (lost.length > 0) {
        bus.emit({ source: 'sync', tables: ['groups'], groupIds: lost });
      }
      return { applied, skipped, held, lost, more: stagedGroups(db).length > 0 };
    },

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
