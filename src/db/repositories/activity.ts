import { isNull } from 'drizzle-orm';

import { money, type Money } from '@/domain';

import { groupMembers, groups } from '../schema';
import { listExpensesWithParts } from './expenses';
import type { Group, Member } from './queries';
import { listTransfers } from './transfers';
import type { RepositoryContext } from './types';

/** Miembro mencionado en un movimiento, con su nombre actual aunque ya no esté. */
export interface ActivityParty {
  readonly memberId: string;
  readonly name: string;
  /** Verdadero si el miembro ya no está en el grupo. */
  readonly removed: boolean;
}

/** Pagador, receptor o participante con su monto en la moneda del grupo. */
export interface ActivityShare extends ActivityParty {
  readonly amount: Money;
}

interface ActivityBase {
  readonly id: string;
  readonly version: number;
  readonly groupId: string;
  readonly groupName: string;
  readonly groupCurrency: string;
  readonly occurredOn: string;
  /** Monto en la moneda en que se registró. */
  readonly amount: Money;
  /** Monto en la moneda del grupo. Nunca se suma con el de otro grupo. */
  readonly groupAmount: Money;
  readonly exchangeRate: string;
}

export interface ActivityEntry extends ActivityBase {
  readonly kind: 'expense' | 'income';
  readonly title: string;
  readonly categoryId: string | null;
  readonly splitMethod: 'equal' | 'exact' | 'percentage' | 'shares';
  /** Pagadores en un gasto; receptores en un ingreso. */
  readonly payers: readonly ActivityShare[];
  readonly splits: readonly ActivityShare[];
}

export interface ActivityTransfer extends ActivityBase {
  readonly kind: 'transfer';
  readonly from: ActivityParty;
  readonly to: ActivityParty;
}

export type ActivityItem = ActivityEntry | ActivityTransfer;

/** Orden del historial: por día, y dentro del día, lo registrado después primero. */
const newestFirst = (a: ActivityItem, b: ActivityItem) =>
  a.occurredOn !== b.occurredOn
    ? a.occurredOn < b.occurredOn
      ? 1
      : -1
    : a.id < b.id
      ? 1
      : a.id > b.id
        ? -1
        : 0;

export function createActivityRepository(ctx: RepositoryContext) {
  const { db } = ctx;

  return {
    /**
     * Gastos, ingresos y transferencias activos de un grupo o, sin `groupId`, de todos los
     * grupos (también los archivados), del más reciente al más antiguo. Cada fila conserva su
     * moneda: el historial nunca suma ni compara montos de grupos distintos.
     */
    list(options: { groupId?: string } = {}): ActivityItem[] {
      const groupRows: Group[] = db.select().from(groups).where(isNull(groups.deletedAt)).all();
      const groupById = new Map(groupRows.map((group) => [group.id, group]));
      const memberById = new Map<string, Member>(
        db
          .select()
          .from(groupMembers)
          .all()
          .map((member) => [member.id, member]),
      );
      const party = (memberId: string): ActivityParty => {
        const member = memberById.get(memberId);
        return {
          memberId,
          name: member?.displayName ?? '',
          removed: member?.deletedAt != null,
        };
      };

      const items: ActivityItem[] = [];
      for (const expense of listExpensesWithParts(db, options.groupId)) {
        const group = groupById.get(expense.groupId);
        if (!group) {
          continue;
        }
        const share = (memberId: string, amount: number): ActivityShare => ({
          ...party(memberId),
          amount: money(amount, group.currency),
        });
        items.push({
          kind: expense.kind,
          id: expense.id,
          version: expense.version,
          groupId: group.id,
          groupName: group.name,
          groupCurrency: group.currency,
          occurredOn: expense.occurredOn,
          title: expense.title,
          categoryId: expense.categoryId,
          splitMethod: expense.splitMethod,
          amount: money(expense.amount, expense.currency),
          groupAmount: money(expense.groupAmount, group.currency),
          exchangeRate: expense.exchangeRate,
          payers: expense.payers.map((p) => share(p.memberId, p.groupAmount)),
          splits: expense.splits.map((s) => share(s.memberId, s.groupAmount)),
        });
      }
      for (const transfer of listTransfers(db, options.groupId)) {
        const group = groupById.get(transfer.groupId);
        if (!group) {
          continue;
        }
        items.push({
          kind: 'transfer',
          id: transfer.id,
          version: transfer.version,
          groupId: group.id,
          groupName: group.name,
          groupCurrency: group.currency,
          occurredOn: transfer.occurredOn,
          amount: money(transfer.amount, transfer.currency),
          groupAmount: money(transfer.groupAmount, group.currency),
          exchangeRate: transfer.exchangeRate,
          from: party(transfer.fromMemberId),
          to: party(transfer.toMemberId),
        });
      }
      return items.sort(newestFirst);
    },
  };
}
