import { discardConflict, getConflict, listConflicts } from '../sync/conflicts';
import type { ConflictDraft } from '../sync/conflicts';
import type { RepositoryContext } from './types';

export type { ConflictDraft };

/**
 * Borradores por revisar: lo que el servidor rechazó de los cambios del usuario. La sincronización
 * los escribe; las pantallas los leen y, cuando el usuario decide, los descartan. Es lo único que
 * borra un borrador.
 */
export function createConflictsRepository(ctx: RepositoryContext) {
  const { db } = ctx;

  return {
    /** Los de un grupo, o los de todos si no se da, del más antiguo al más nuevo. */
    list(groupId?: string): ConflictDraft[] {
      return listConflicts(db, groupId);
    },

    get(id: string): ConflictDraft | undefined {
      return getConflict(db, id);
    },

    /** Quita un borrador ya revisado. Verdadero si existía. */
    discard(id: string): boolean {
      const draft = getConflict(db, id);
      const removed = discardConflict(db, id);
      if (removed) {
        ctx.notify(['sync_conflicts'], draft ? [draft.groupId] : null);
      }
      return removed;
    },
  };
}
