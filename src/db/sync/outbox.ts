import { asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logger } from '@/lib/logger';

import type { TableName } from '../changes';
import type { AppDatabase } from '../repositories/types';
import {
  categories,
  expensePayers,
  expenses,
  expenseSplits,
  groupMembers,
  groups,
  syncConflicts,
  syncOutbox,
  transfers,
} from '../schema';
import {
  parseRemoteRows,
  removeNewMovementLocally,
  replaceUnitFromServer,
  RemoteRowError,
  serverRoot,
  tablesOf,
} from './apply';
import { recordConflict } from './conflicts';
import type { BatchLimits, SyncCounts, SyncDeps, SyncNotice } from './types';
import { compareUnits, listPendingUnits, readUnit } from './units';
import type { Mutation, PushResult, RemoteRow, SyncEntity } from './wire';

/**
 * La cola de envío. Una unidad pendiente se convierte en un envío con su propio id y contenido, que
 * se guarda en `sync_outbox` antes de salir: si no hay respuesta, se repite igual y el servidor lo
 * reconoce. Las respuestas se aplican una por una, cada una en su transacción.
 */

type OutboxRow = typeof syncOutbox.$inferSelect;

const dataSchema = z.record(z.string(), z.unknown());

/** Bytes de un texto en UTF-8, sin depender de `TextEncoder`. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Par sustituto: cuatro bytes entre los dos.
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function parseData(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = dataSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const unitKey = (entity: string, id: string) => `${entity}:${id}`;

/**
 * Los envíos del próximo lote: primero los que ya salieron sin respuesta (mismo id y contenido) y
 * después los de las unidades pendientes, que se guardan antes de devolverse. El lote respeta el
 * máximo de envíos y de bytes, pero lleva al menos uno.
 */
export function nextBatch(db: AppDatabase, limits: BatchLimits, deps: SyncDeps): Mutation[] {
  const batch: Mutation[] = [];
  let bytes = 0;
  const fits = (mutation: Mutation): boolean => {
    const size = utf8Length(JSON.stringify(mutation));
    if (batch.length > 0 && (batch.length >= limits.count || bytes + size > limits.bytes)) {
      return false;
    }
    batch.push(mutation);
    bytes += size;
    return true;
  };

  const stored = db.select().from(syncOutbox).orderBy(asc(syncOutbox.createdAt)).all();
  const taken = new Set<string>();
  const inFlight: OutboxRow[] = [];
  for (const row of stored) {
    const data = parseData(row.data);
    if (row.state === 'in_flight' && data === undefined) {
      // Ilegible: se descarta el envío y la unidad sigue pendiente, así que sale como nueva.
      db.delete(syncOutbox).where(eq(syncOutbox.id, row.id)).run();
      continue;
    }
    taken.add(unitKey(row.entity, row.entityId));
    if (row.state === 'in_flight') {
      inFlight.push(row);
    }
  }

  inFlight.sort((a, b) =>
    compareUnits(
      { entity: a.entity, id: a.entityId, groupId: a.groupId },
      { entity: b.entity, id: b.entityId, groupId: b.groupId },
    ),
  );
  for (const row of inFlight) {
    const data = parseData(row.data) as Record<string, unknown>;
    if (!fits({ id: row.id, entity: row.entity, base: row.base, data })) {
      return batch;
    }
  }

  const fresh: { mutation: Mutation; entityId: string; groupId: string }[] = [];
  for (const ref of listPendingUnits(db)) {
    if (taken.has(unitKey(ref.entity, ref.id))) {
      continue;
    }
    const unit = readUnit(db, ref);
    if (!unit) {
      continue;
    }
    const mutation: Mutation = {
      id: deps.newId(),
      entity: unit.entity,
      base: unit.base,
      data: unit.data,
    };
    if (!fits(mutation)) {
      break;
    }
    fresh.push({ mutation, entityId: unit.id, groupId: unit.groupId });
  }

  if (fresh.length > 0) {
    const createdAt = deps.now();
    db.transaction((tx) => {
      for (const { mutation, entityId, groupId } of fresh) {
        tx.insert(syncOutbox)
          .values({
            id: mutation.id,
            entity: mutation.entity,
            entityId,
            groupId,
            base: mutation.base,
            data: JSON.stringify(mutation.data),
            state: 'in_flight',
            createdAt,
          })
          .run();
      }
    });
  }
  return batch;
}

/** Qué cambió en la base local al aplicar una respuesta, para avisar en el bus. */
export interface ApplyEffect {
  readonly tables: readonly TableName[];
  readonly groupId: string;
  readonly notice: SyncNotice;
}

/**
 * Aplica la respuesta del servidor a un envío. Devuelve qué cambió en pantalla solo si hubo un
 * rechazo; un envío aplicado o apartado no cambia nada que se vea. Una respuesta a un envío que no
 * está en vuelo se ignora.
 */
export function applyPushResult(
  db: AppDatabase,
  result: PushResult,
  deps: SyncDeps,
): ApplyEffect | undefined {
  const row = db.select().from(syncOutbox).where(eq(syncOutbox.id, result.id)).get();
  if (!row || row.state !== 'in_flight') {
    return undefined;
  }

  if (result.status === 'failed') {
    db.update(syncOutbox)
      .set({ state: 'failed', failReason: result.reason, failField: result.field ?? null })
      .where(eq(syncOutbox.id, row.id))
      .run();
    return undefined;
  }

  if (result.status === 'applied') {
    db.transaction((tx) => applyApplied(tx, row, result.version, result.current));
    return undefined;
  }

  try {
    return db.transaction((tx) => applyRejected(tx, row, result.reason, result.current, deps));
  } catch (error) {
    // No se pudo dejar la unidad como el servidor la tiene (por ejemplo, falta un miembro que
    // todavía no se descarga). Nada se pierde: lo del usuario sigue como estaba y el envío queda
    // apartado hasta que se reintente.
    logger.error('No se pudo aplicar el estado del servidor a un envío rechazado', error);
    db.update(syncOutbox)
      .set({ state: 'failed', failReason: 'error', failField: null })
      .where(eq(syncOutbox.id, row.id))
      .run();
    return undefined;
  }
}

const childRow = z.object({ id: z.guid(), version: z.int().min(1) });

/** Guarda la versión del servidor y, si nada cambió en vuelo, deja la unidad al día. */
function applyApplied(
  tx: AppDatabase,
  row: OutboxRow,
  serverVersion: number,
  current: readonly RemoteRow[],
): void {
  const sent = parseData(row.data);
  const unit = readUnit(tx, { entity: row.entity, id: row.entityId });
  const unchanged = unit !== undefined && JSON.stringify(unit.data) === JSON.stringify(sent);

  setRootServerVersion(tx, row.entity, row.entityId, serverVersion);
  for (const { table, row: remote } of current) {
    const child = childRow.safeParse(remote);
    if (!child.success) {
      continue;
    }
    if (table === 'expense_payers') {
      tx.update(expensePayers)
        .set({ serverVersion: child.data.version })
        .where(eq(expensePayers.id, child.data.id))
        .run();
    } else if (table === 'expense_splits') {
      tx.update(expenseSplits)
        .set({ serverVersion: child.data.version })
        .where(eq(expenseSplits.id, child.data.id))
        .run();
    }
  }
  if (unchanged) {
    markUnitSynced(tx, row.entity, row.entityId);
  }
  tx.delete(syncOutbox).where(eq(syncOutbox.id, row.id)).run();
}

function setRootServerVersion(tx: AppDatabase, entity: SyncEntity, id: string, version: number) {
  switch (entity) {
    case 'group':
      tx.update(groups).set({ serverVersion: version }).where(eq(groups.id, id)).run();
      return;
    case 'member':
      tx.update(groupMembers).set({ serverVersion: version }).where(eq(groupMembers.id, id)).run();
      return;
    case 'category':
      tx.update(categories).set({ serverVersion: version }).where(eq(categories.id, id)).run();
      return;
    case 'expense':
      tx.update(expenses).set({ serverVersion: version }).where(eq(expenses.id, id)).run();
      return;
    case 'transfer':
      tx.update(transfers).set({ serverVersion: version }).where(eq(transfers.id, id)).run();
      return;
  }
}

/** La unidad y, en un gasto, todos sus pagadores y partes quedan confirmados. */
function markUnitSynced(tx: AppDatabase, entity: SyncEntity, id: string) {
  switch (entity) {
    case 'group':
      tx.update(groups)
        .set({ syncedVersion: sql`${groups.version}` })
        .where(eq(groups.id, id))
        .run();
      return;
    case 'member':
      tx.update(groupMembers)
        .set({ syncedVersion: sql`${groupMembers.version}` })
        .where(eq(groupMembers.id, id))
        .run();
      return;
    case 'category':
      tx.update(categories)
        .set({ syncedVersion: sql`${categories.version}` })
        .where(eq(categories.id, id))
        .run();
      return;
    case 'expense':
      tx.update(expenses)
        .set({ syncedVersion: sql`${expenses.version}` })
        .where(eq(expenses.id, id))
        .run();
      tx.update(expensePayers)
        .set({ syncedVersion: sql`${expensePayers.version}` })
        .where(eq(expensePayers.expenseId, id))
        .run();
      tx.update(expenseSplits)
        .set({ syncedVersion: sql`${expenseSplits.version}` })
        .where(eq(expenseSplits.expenseId, id))
        .run();
      return;
    case 'transfer':
      tx.update(transfers)
        .set({ syncedVersion: sql`${transfers.version}` })
        .where(eq(transfers.id, id))
        .run();
      return;
  }
}

function memberName(tx: AppDatabase, id: unknown): string {
  if (typeof id !== 'string') {
    return '';
  }
  return (
    tx
      .select({ name: groupMembers.displayName })
      .from(groupMembers)
      .where(eq(groupMembers.id, id))
      .get()?.name ?? ''
  );
}

/** Cómo llamar a la unidad en un aviso: su nombre o título, según la versión del usuario. */
function labelOf(tx: AppDatabase, entity: SyncEntity, data: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  switch (entity) {
    case 'group':
    case 'category':
      return text(data.name);
    case 'member':
      return text(data.display_name);
    case 'expense':
      return text(data.title);
    case 'transfer':
      return `${memberName(tx, data.from_member_id)} → ${memberName(tx, data.to_member_id)}`;
  }
}

/**
 * Rechazo: la unidad vuelve al estado del servidor y lo del usuario queda en un borrador. Si el
 * usuario siguió editando mientras el envío estaba en vuelo, el borrador guarda esa versión más
 * nueva, que incluye lo que se envió. Lanza (y la transacción se deshace) si no puede dejar la
 * unidad como el servidor la tiene.
 */
function applyRejected(
  tx: AppDatabase,
  row: OutboxRow,
  reason: Extract<PushResult, { status: 'rejected' }>['reason'],
  current: readonly RemoteRow[],
  deps: SyncDeps,
): ApplyEffect {
  const now = deps.now();
  const latest =
    readUnit(tx, { entity: row.entity, id: row.entityId })?.data ?? parseData(row.data);
  if (!latest) {
    throw new RemoteRowError();
  }
  const label = labelOf(tx, row.entity, latest);
  const rows = parseRemoteRows(current);
  const root = serverRoot(rows, row.entity, row.entityId);
  const wasNew = row.base === null;

  if (root) {
    replaceUnitFromServer(tx, row.entity, row.entityId, rows, now);
  } else if (wasNew && (row.entity === 'expense' || row.entity === 'transfer')) {
    removeNewMovementLocally(tx, row.entity, row.entityId, now);
  } else {
    throw new RemoteRowError();
  }

  const draft = {
    id: deps.newId(),
    entity: row.entity,
    entityId: row.entityId,
    groupId: row.groupId,
    reason,
    data: latest,
    serverDeleted: root !== undefined && root.deletedAt !== null,
    wasNew,
    wasDeletion: latest.deleted === true,
    createdAt: now,
  };
  recordConflict(tx, draft);
  tx.delete(syncOutbox).where(eq(syncOutbox.id, row.id)).run();

  return {
    tables: [...tablesOf(row.entity), 'sync_conflicts'],
    groupId: row.groupId,
    notice: {
      draftId: draft.id,
      groupId: row.groupId,
      entity: row.entity,
      reason,
      label,
      serverDeleted: draft.serverDeleted,
      wasNew,
      wasDeletion: draft.wasDeletion,
    },
  };
}

export function countSync(db: AppDatabase): SyncCounts {
  const failedRows = db
    .select({ entity: syncOutbox.entity, entityId: syncOutbox.entityId })
    .from(syncOutbox)
    .where(eq(syncOutbox.state, 'failed'))
    .all();
  const failedKeys = new Set(failedRows.map((row) => unitKey(row.entity, row.entityId)));
  const pending = listPendingUnits(db).filter(
    (unit) => !failedKeys.has(unitKey(unit.entity, unit.id)),
  ).length;
  const conflicts = db.select({ n: count() }).from(syncConflicts).get()?.n ?? 0;
  return { pending, failed: failedRows.length, conflicts };
}

/** Devuelve los envíos apartados a la cola: se vuelven a armar con un id y contenido nuevos. */
export function retryFailed(db: AppDatabase): number {
  return db
    .delete(syncOutbox)
    .where(eq(syncOutbox.state, 'failed'))
    .returning({ id: syncOutbox.id })
    .all().length;
}
