import { and, desc, eq, isNull } from 'drizzle-orm';

import { convert, money } from '@/domain';

import { transfers } from '../schema';
import { invalid, parse } from './errors';
import { listMembers, requireGroup } from './groups';
import type { AppDatabase, RepositoryDeps } from './types';
import { addTransferSchema, type AddTransferInput } from './validation';

export type TransferRow = typeof transfers.$inferSelect;

export function createTransfersRepository(db: AppDatabase, deps: RepositoryDeps) {
  return {
    /** Registra un pago entre dos miembros del grupo, convertido si hace falta. */
    add(input: AddTransferInput): TransferRow {
      const data = parse(addTransferSchema, input);
      const group = requireGroup(db, data.groupId);
      const memberIds = new Set(listMembers(db, group.id).map((m) => m.id));
      if (!memberIds.has(data.fromMemberId) || !memberIds.has(data.toMemberId)) {
        throw invalid('Hay miembros que no pertenecen al grupo');
      }
      const amount = money(data.amount, data.currency);
      const sameCurrency = data.currency === group.currency;
      if (!sameCurrency && !data.exchangeRate) {
        throw invalid('Falta la tasa de cambio a la moneda del grupo');
      }
      const rate = sameCurrency ? '1' : (data.exchangeRate as string);
      const groupAmount = sameCurrency ? amount : convert(amount, group.currency, rate);
      if (groupAmount.amount <= 0) {
        throw invalid('El monto convertido es demasiado pequeño para la moneda del grupo');
      }
      const now = deps.now();
      return db
        .insert(transfers)
        .values({
          id: deps.newId(),
          createdAt: now,
          updatedAt: now,
          groupId: group.id,
          fromMemberId: data.fromMemberId,
          toMemberId: data.toMemberId,
          amount: amount.amount,
          currency: amount.currency,
          groupAmount: groupAmount.amount,
          exchangeRate: rate,
          rateDate: sameCurrency ? null : (data.rateDate ?? null),
          occurredOn: data.occurredOn,
        })
        .returning()
        .get();
    },

    listByGroup(groupId: string): TransferRow[] {
      return db
        .select()
        .from(transfers)
        .where(and(eq(transfers.groupId, groupId), isNull(transfers.deletedAt)))
        .orderBy(desc(transfers.occurredOn), desc(transfers.id))
        .all();
    },
  };
}
