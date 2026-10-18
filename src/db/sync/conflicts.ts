import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AppDatabase } from '../repositories/types';
import { syncConflicts } from '../schema';
import {
  QUOTA_KINDS,
  REJECT_REASONS,
  SYNC_ENTITIES,
  type QuotaKind,
  type RejectReason,
  type SyncEntity,
} from './wire';

/**
 * Un cambio del usuario que el servidor rechazó. Nunca se pierde: queda aquí hasta que el usuario
 * lo revise y lo descarte (`discardConflict`).
 */
export interface ConflictDraft {
  readonly id: string;
  readonly entity: SyncEntity;
  readonly entityId: string;
  readonly groupId: string;
  readonly reason: RejectReason;
  /** El cupo alcanzado; solo con `reason: 'quota'`. */
  readonly quota?: QuotaKind;
  /** La versión del usuario, tal como la envió la sincronización. */
  readonly data: Readonly<Record<string, unknown>>;
  /** En el servidor está borrada. */
  readonly serverDeleted: boolean;
  /** Nunca llegó al servidor. */
  readonly wasNew: boolean;
  /** El cambio rechazado era un borrado. */
  readonly wasDeletion: boolean;
  readonly createdAt: number;
}

export type NewConflict = ConflictDraft;

const dataSchema = z.record(z.string(), z.unknown());
const reasonSchema = z.enum(REJECT_REASONS);
const quotaSchema = z.enum(QUOTA_KINDS);
const entitySchema = z.enum(SYNC_ENTITIES);

type ConflictRow = typeof syncConflicts.$inferSelect;

/** `undefined` si lo guardado no se puede leer: no rompe la lista, y la fila se conserva. */
function toDraft(row: ConflictRow): ConflictDraft | undefined {
  let json: unknown;
  try {
    json = JSON.parse(row.data);
  } catch {
    return undefined;
  }
  const data = dataSchema.safeParse(json);
  const reason = reasonSchema.safeParse(row.reason);
  const entity = entitySchema.safeParse(row.entity);
  const quota = quotaSchema.safeParse(row.quota);
  if (!data.success || !reason.success || !entity.success) {
    return undefined;
  }
  return {
    id: row.id,
    entity: entity.data,
    entityId: row.entityId,
    groupId: row.groupId,
    reason: reason.data,
    ...(quota.success ? { quota: quota.data } : {}),
    data: data.data,
    serverDeleted: row.serverDeleted,
    wasNew: row.wasNew,
    wasDeletion: row.wasDeletion,
    createdAt: row.createdAt,
  };
}

/** Guarda un borrador. Lo usa la sincronización al aplicar un rechazo. */
export function recordConflict(db: AppDatabase, conflict: NewConflict): void {
  db.insert(syncConflicts)
    .values({
      id: conflict.id,
      entity: conflict.entity,
      entityId: conflict.entityId,
      groupId: conflict.groupId,
      reason: conflict.reason,
      quota: conflict.reason === 'quota' ? (conflict.quota ?? null) : null,
      data: JSON.stringify(conflict.data),
      serverDeleted: conflict.serverDeleted,
      wasNew: conflict.wasNew,
      wasDeletion: conflict.wasDeletion,
      createdAt: conflict.createdAt,
    })
    .run();
}

/** Borradores por revisar, del más antiguo al más nuevo; de un grupo o de todos. */
export function listConflicts(db: AppDatabase, groupId?: string): ConflictDraft[] {
  return db
    .select()
    .from(syncConflicts)
    .where(groupId === undefined ? undefined : eq(syncConflicts.groupId, groupId))
    .orderBy(asc(syncConflicts.createdAt), asc(syncConflicts.id))
    .all()
    .map(toDraft)
    .filter((draft): draft is ConflictDraft => draft !== undefined);
}

export function getConflict(db: AppDatabase, id: string): ConflictDraft | undefined {
  const row = db.select().from(syncConflicts).where(eq(syncConflicts.id, id)).get();
  return row ? toDraft(row) : undefined;
}

/** Quita un borrador que el usuario ya revisó. Es lo único que borra borradores. */
export function discardConflict(db: AppDatabase, id: string): boolean {
  const removed = db
    .delete(syncConflicts)
    .where(eq(syncConflicts.id, id))
    .returning({ id: syncConflicts.id })
    .all();
  return removed.length > 0;
}
