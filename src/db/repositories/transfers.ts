import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { convert, money } from '@/domain';

import { transfers } from '../schema';
import { conflict, invalid, notFound, parse } from './errors';
import { listMembers, requireWritableGroup, type Group } from './queries';
import type { AppDatabase, RepositoryContext } from './types';
import { addTransferSchema, type AddTransferInput } from './validation';

export type TransferRow = typeof transfers.$inferSelect;

/** Transferencias activas, de un grupo o de todos, de la más reciente a la más antigua. */
export function listTransfers(db: AppDatabase, groupId?: string): TransferRow[] {
  return db
    .select()
    .from(transfers)
    .where(
      and(
        groupId === undefined ? undefined : eq(transfers.groupId, groupId),
        isNull(transfers.deletedAt),
      ),
    )
    .orderBy(desc(transfers.occurredOn), desc(transfers.id))
    .all();
}

/** Valida los miembros y convierte el monto a la moneda del grupo. */
function prepareTransfer(
  db: AppDatabase,
  group: Group,
  input: AddTransferInput,
  allowed?: Set<string>,
) {
  const data = parse(addTransferSchema, input);
  const memberIds = allowed ?? new Set(listMembers(db, group.id).map((m) => m.id));
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
  return {
    groupId: group.id,
    fromMemberId: data.fromMemberId,
    toMemberId: data.toMemberId,
    amount: amount.amount,
    currency: amount.currency,
    groupAmount: groupAmount.amount,
    exchangeRate: rate,
    rateDate: sameCurrency ? null : (data.rateDate ?? null),
    occurredOn: data.occurredOn,
  };
}

export function createTransfersRepository(ctx: RepositoryContext) {
  const { db, deps } = ctx;

  function find(id: string, deleted: boolean): TransferRow | undefined {
    return db
      .select()
      .from(transfers)
      .where(
        and(
          eq(transfers.id, id),
          deleted ? isNotNull(transfers.deletedAt) : isNull(transfers.deletedAt),
        ),
      )
      .get();
  }

  /** Cambia el estado de una transferencia con bloqueo optimista y avisa del cambio. */
  function updateVersioned(
    current: TransferRow,
    expectedVersion: number,
    values: Partial<typeof transfers.$inferInsert>,
  ): TransferRow {
    const [updated] = db
      .update(transfers)
      .set({ ...values, updatedAt: deps.now(), version: sql`${transfers.version} + 1` })
      .where(and(eq(transfers.id, current.id), eq(transfers.version, expectedVersion)))
      .returning()
      .all();
    if (!updated) {
      throw conflict('La transferencia');
    }
    ctx.notify(['transfers'], [current.groupId]);
    return updated;
  }

  return {
    /** Registra un pago entre dos miembros del grupo, convertido si hace falta. */
    add(input: AddTransferInput): TransferRow {
      const group = requireWritableGroup(db, parse(addTransferSchema, input).groupId);
      const values = prepareTransfer(db, group, input);
      const now = deps.now();
      const row = db
        .insert(transfers)
        .values({ id: deps.newId(), createdAt: now, updatedAt: now, ...values })
        .returning()
        .get();
      ctx.notify(['transfers'], [group.id]);
      return row;
    },

    get(id: string): TransferRow | undefined {
      return find(id, false);
    },

    /** Reemplaza los datos de la transferencia; puede seguir mencionando a miembros quitados. */
    update(id: string, expectedVersion: number, input: AddTransferInput): TransferRow {
      const current = find(id, false);
      if (!current) {
        throw notFound('La transferencia');
      }
      if (input.groupId !== current.groupId) {
        throw invalid('Una transferencia no cambia de grupo');
      }
      const group = requireWritableGroup(db, current.groupId);
      const allowed = new Set([
        ...listMembers(db, group.id).map((m) => m.id),
        current.fromMemberId,
        current.toMemberId,
      ]);
      return updateVersioned(current, expectedVersion, prepareTransfer(db, group, input, allowed));
    },

    listByGroup(groupId: string): TransferRow[] {
      return listTransfers(db, groupId);
    },

    /** Borrado lógico con bloqueo optimista. */
    remove(id: string, expectedVersion: number): void {
      const current = find(id, false);
      if (!current) {
        throw notFound('La transferencia');
      }
      requireWritableGroup(db, current.groupId);
      updateVersioned(current, expectedVersion, { deletedAt: deps.now() });
    },

    /** Deshace un borrado. */
    restore(id: string, expectedVersion: number): void {
      const removed = find(id, true);
      if (!removed) {
        throw notFound('La transferencia borrada');
      }
      requireWritableGroup(db, removed.groupId);
      updateVersioned(removed, expectedVersion, { deletedAt: null });
    },
  };
}
