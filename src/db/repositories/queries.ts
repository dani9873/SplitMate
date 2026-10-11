import { and, asc, eq, isNull } from 'drizzle-orm';

import { groupMembers, groups } from '../schema';
import { notFound, ruleViolation } from './errors';
import type { AppDatabase } from './types';

export type Group = typeof groups.$inferSelect;
export type Member = typeof groupMembers.$inferSelect;

/** Grupo activo (no borrado) o `NOT_FOUND`. Un grupo archivado sigue siendo legible. */
export function requireGroup(db: AppDatabase, id: string): Group {
  const group = db
    .select()
    .from(groups)
    .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
    .get();
  if (!group) {
    throw notFound('El grupo');
  }
  return group;
}

/** Grupo que admite escrituras: existe y no está archivado. */
export function requireWritableGroup(db: AppDatabase, id: string): Group {
  const group = requireGroup(db, id);
  if (group.archivedAt !== null) {
    throw ruleViolation('GROUP_ARCHIVED', 'El grupo está archivado: es de solo lectura');
  }
  return group;
}

/** Miembros activos de un grupo en orden de creación, que es el orden de sus UUID v7. */
export function listMembers(db: AppDatabase, groupId: string): Member[] {
  return db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.deletedAt)))
    .orderBy(asc(groupMembers.id))
    .all();
}

/** Todos los miembros de un grupo, incluidos los quitados, para nombrarlos en el historial. */
export function listAllMembers(db: AppDatabase, groupId: string): Member[] {
  return db
    .select()
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.id))
    .all();
}
