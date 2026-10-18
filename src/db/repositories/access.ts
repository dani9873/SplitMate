import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { ALL_TABLES } from '../changes';
import {
  categories,
  expensePayers,
  expenses,
  expenseSplits,
  groupAccess,
  groupMembers,
  groups,
  invitationLinks,
  syncConflicts,
  syncCursors,
  syncOutbox,
  syncPullPages,
  transfers,
} from '../schema';
import { invalid, notFound } from './errors';
import { readLocalUser } from './profile';
import type { AppDatabase, RepositoryContext } from './types';

export type AccessRole = 'owner' | 'member';

/** Una cuenta con acceso activo a un grupo, tal como lo dice el servidor. */
export interface AccessEntry {
  readonly id: string;
  readonly userId: string;
  readonly role: AccessRole;
  /** Es la cuenta de este teléfono. */
  readonly isMe: boolean;
}

/** ¿La cuenta tiene acceso activo al grupo, según lo que bajó el teléfono? */
export function hasActiveAccess(db: AppDatabase, groupId: string, userId: string): boolean {
  return (
    db
      .select({ id: groupAccess.id })
      .from(groupAccess)
      .where(
        and(
          eq(groupAccess.groupId, groupId),
          eq(groupAccess.userId, userId),
          isNull(groupAccess.deletedAt),
        ),
      )
      .get() !== undefined
  );
}

/**
 * Quién tiene acceso a cada grupo y el estado de acceso de este teléfono. `group_access` es de solo
 * bajada: lo escribe la sincronización; aquí solo se lee, salvo quitar del teléfono un grupo que ya
 * no se ve.
 */
export function createAccessRepository(ctx: RepositoryContext) {
  const { db } = ctx;

  const localUserId = () => readLocalUser(db)?.id ?? null;

  function listActive(groupId: string): AccessEntry[] {
    const me = localUserId();
    return db
      .select()
      .from(groupAccess)
      .where(and(eq(groupAccess.groupId, groupId), isNull(groupAccess.deletedAt)))
      .orderBy(asc(groupAccess.createdAt), asc(groupAccess.id))
      .all()
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        role: row.role,
        isMe: me !== null && row.userId === me,
      }));
  }

  return {
    /** Las cuentas con acceso activo al grupo. Vacío si el grupo todavía no bajó su acceso. */
    listActive,

    /**
     * Mi papel en el grupo: `owner` o `member`; `null` si ya no tengo acceso. Un grupo que todavía
     * no tiene filas de acceso (lo creé aquí y no se ha subido) es mío.
     */
    myRole(groupId: string): AccessRole | null {
      const entries = listActive(groupId);
      if (entries.length === 0) {
        return 'owner';
      }
      return entries.find((entry) => entry.isMe)?.role ?? null;
    },

    /** El servidor dijo que esta cuenta ya no ve el grupo: es una copia de solo lectura. */
    isLost(groupId: string): boolean {
      const row = db
        .select({ lostAt: groups.accessLostAt })
        .from(groups)
        .where(eq(groups.id, groupId))
        .get();
      return row?.lostAt != null;
    },

    /**
     * Quita de este teléfono un grupo al que ya no se tiene acceso, con todo lo suyo: movimientos,
     * miembros, accesos, cursores, páginas guardadas, enlaces, borradores y envíos sin subir. No se
     * puede deshacer. Un grupo con acceso no se quita por aquí.
     */
    removeFromPhone(groupId: string): void {
      const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
      if (!group) {
        throw notFound('El grupo');
      }
      if (group.accessLostAt === null) {
        throw invalid('El grupo todavía tiene acceso: no se quita del teléfono');
      }
      db.transaction((tx) => {
        const ofGroup = tx
          .select({ id: expenses.id })
          .from(expenses)
          .where(eq(expenses.groupId, groupId));
        tx.delete(expensePayers).where(inArray(expensePayers.expenseId, ofGroup)).run();
        tx.delete(expenseSplits).where(inArray(expenseSplits.expenseId, ofGroup)).run();
        tx.delete(expenses).where(eq(expenses.groupId, groupId)).run();
        tx.delete(transfers).where(eq(transfers.groupId, groupId)).run();
        tx.delete(categories).where(eq(categories.groupId, groupId)).run();
        tx.delete(groupAccess).where(eq(groupAccess.groupId, groupId)).run();
        tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId)).run();
        tx.delete(invitationLinks).where(eq(invitationLinks.groupId, groupId)).run();
        tx.delete(syncOutbox).where(eq(syncOutbox.groupId, groupId)).run();
        tx.delete(syncConflicts).where(eq(syncConflicts.groupId, groupId)).run();
        tx.delete(syncCursors).where(eq(syncCursors.groupId, groupId)).run();
        tx.delete(syncPullPages).where(eq(syncPullPages.groupId, groupId)).run();
        tx.delete(groups).where(eq(groups.id, groupId)).run();
      });
      ctx.notify([...ALL_TABLES, 'sync_conflicts'], [groupId]);
    },
  };
}
