import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';

import type { AppDatabase } from '../repositories/types';
import {
  categories,
  expensePayers,
  expenses,
  expenseSplits,
  groupMembers,
  groups,
  transfers,
} from '../schema';
import type { SyncEntity } from './wire';

/**
 * Una unidad de sincronización es lo que se envía y se versiona junto: un grupo, un miembro, una
 * categoría, un gasto (con sus pagadores y partes) o una transferencia. Su versión es la de su fila
 * principal: toda escritura local sube esa `version`, así que la unidad queda pendiente sola.
 */
export interface UnitRef {
  readonly entity: SyncEntity;
  readonly id: string;
  readonly groupId: string;
}

export interface UnitState extends UnitRef {
  /** Versión del servidor sobre la que está este estado; `null` si la unidad nunca llegó. */
  readonly base: number | null;
  /** Contenido en el formato de `sync_push`. */
  readonly data: Record<string, unknown>;
}

/** Los padres antes que sus hijos: un gasto menciona miembros, y todo menciona al grupo. */
const RANK: Record<SyncEntity, number> = {
  group: 0,
  member: 1,
  category: 2,
  expense: 3,
  transfer: 4,
};

export const unitRank = (entity: SyncEntity): number => RANK[entity];

/** Orden de envío: por grupo, después por entidad (padres primero) y por creación (id UUID v7). */
export function compareUnits(a: UnitRef, b: UnitRef): number {
  if (a.groupId !== b.groupId) {
    return a.groupId < b.groupId ? -1 : 1;
  }
  if (a.entity !== b.entity) {
    return RANK[a.entity] - RANK[b.entity];
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * Unidades con cambios que el servidor todavía no confirma (`version <> synced_version`), en orden
 * de envío. Las categorías predefinidas no tienen grupo y nunca se envían.
 */
export function listPendingUnits(db: AppDatabase): UnitRef[] {
  const pending: UnitRef[] = [
    ...db
      .select({ id: groups.id })
      .from(groups)
      .where(ne(groups.syncedVersion, groups.version))
      .all()
      .map(({ id }) => ({ entity: 'group' as const, id, groupId: id })),
    ...db
      .select({ id: groupMembers.id, groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(ne(groupMembers.syncedVersion, groupMembers.version))
      .all()
      .map((row) => ({ entity: 'member' as const, ...row })),
    ...db
      .select({ id: categories.id, groupId: categories.groupId })
      .from(categories)
      .where(and(ne(categories.syncedVersion, categories.version), isNotNull(categories.groupId)))
      .all()
      .map((row) => ({ entity: 'category' as const, id: row.id, groupId: row.groupId as string })),
    ...db
      .select({ id: expenses.id, groupId: expenses.groupId })
      .from(expenses)
      .where(ne(expenses.syncedVersion, expenses.version))
      .all()
      .map((row) => ({ entity: 'expense' as const, ...row })),
    ...db
      .select({ id: transfers.id, groupId: transfers.groupId })
      .from(transfers)
      .where(ne(transfers.syncedVersion, transfers.version))
      .all()
      .map((row) => ({ entity: 'transfer' as const, ...row })),
  ];
  return pending.sort(compareUnits);
}

const flag = (instant: number | null) => instant !== null;

/** El estado actual de una unidad, listo para enviar. `undefined` si no existe en esta base. */
export function readUnit(
  db: AppDatabase,
  ref: Pick<UnitRef, 'entity' | 'id'>,
): UnitState | undefined {
  switch (ref.entity) {
    case 'group': {
      const row = db.select().from(groups).where(eq(groups.id, ref.id)).get();
      return (
        row && {
          entity: 'group',
          id: row.id,
          groupId: row.id,
          base: row.serverVersion,
          data: {
            id: row.id,
            name: row.name,
            currency: row.currency,
            emoji: row.emoji,
            color: row.color,
            archived: flag(row.archivedAt),
            deleted: flag(row.deletedAt),
          },
        }
      );
    }
    case 'member': {
      const row = db.select().from(groupMembers).where(eq(groupMembers.id, ref.id)).get();
      return (
        row && {
          entity: 'member',
          id: row.id,
          groupId: row.groupId,
          base: row.serverVersion,
          data: {
            id: row.id,
            group_id: row.groupId,
            display_name: row.displayName,
            user_id: row.userId,
            role: row.role,
            deleted: flag(row.deletedAt),
          },
        }
      );
    }
    case 'category': {
      const row = db.select().from(categories).where(eq(categories.id, ref.id)).get();
      if (!row || row.groupId === null) {
        return undefined;
      }
      return {
        entity: 'category',
        id: row.id,
        groupId: row.groupId,
        base: row.serverVersion,
        data: {
          id: row.id,
          group_id: row.groupId,
          name: row.name,
          icon: row.icon,
          deleted: flag(row.deletedAt),
        },
      };
    }
    case 'expense': {
      const row = db.select().from(expenses).where(eq(expenses.id, ref.id)).get();
      if (!row) {
        return undefined;
      }
      const deleted = flag(row.deletedAt);
      const payers = deleted
        ? []
        : db
            .select()
            .from(expensePayers)
            .where(and(eq(expensePayers.expenseId, row.id), isNull(expensePayers.deletedAt)))
            .orderBy(asc(expensePayers.id))
            .all();
      const splits = deleted
        ? []
        : db
            .select()
            .from(expenseSplits)
            .where(and(eq(expenseSplits.expenseId, row.id), isNull(expenseSplits.deletedAt)))
            .orderBy(asc(expenseSplits.id))
            .all();
      return {
        entity: 'expense',
        id: row.id,
        groupId: row.groupId,
        base: row.serverVersion,
        data: {
          id: row.id,
          group_id: row.groupId,
          kind: row.kind,
          title: row.title,
          amount: row.amount,
          currency: row.currency,
          group_currency: row.groupCurrency,
          group_amount: row.groupAmount,
          exchange_rate: row.exchangeRate,
          rate_date: row.rateDate,
          split_method: row.splitMethod,
          category_id: row.categoryId,
          occurred_on: row.occurredOn,
          // El servidor no acepta un texto vacío: sin notas es nulo.
          notes: row.notes === '' ? null : row.notes,
          deleted,
          payers: payers.map((p) => ({
            id: p.id,
            member_id: p.memberId,
            amount: p.amount,
            group_amount: p.groupAmount,
          })),
          splits: splits.map((p) => ({
            id: p.id,
            member_id: p.memberId,
            amount: p.amount,
            group_amount: p.groupAmount,
            input_value: p.inputValue,
          })),
        },
      };
    }
    case 'transfer': {
      const row = db.select().from(transfers).where(eq(transfers.id, ref.id)).get();
      return (
        row && {
          entity: 'transfer',
          id: row.id,
          groupId: row.groupId,
          base: row.serverVersion,
          data: {
            id: row.id,
            group_id: row.groupId,
            from_member_id: row.fromMemberId,
            to_member_id: row.toMemberId,
            amount: row.amount,
            currency: row.currency,
            group_currency: row.groupCurrency,
            group_amount: row.groupAmount,
            exchange_rate: row.exchangeRate,
            rate_date: row.rateDate,
            occurred_on: row.occurredOn,
            deleted: flag(row.deletedAt),
          },
        }
      );
    }
  }
}
