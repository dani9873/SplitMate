import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  convert,
  convertParts,
  money,
  splitAmount,
  validatePayers,
  type MemberAmount,
  type MemberId,
  type SplitInput,
} from '@/domain';

import { categories, expensePayers, expenseSplits, expenses } from '../schema';
import { conflict, invalid, notFound, parse } from './errors';
import { listMembers, requireGroup } from './groups';
import type { AppDatabase, RepositoryDeps } from './types';
import { addExpenseSchema, type AddExpenseInput } from './validation';

export type Expense = typeof expenses.$inferSelect;
export type ExpensePayer = typeof expensePayers.$inferSelect;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;
export interface ExpenseWithParts extends Expense {
  readonly payers: ExpensePayer[];
  readonly splits: ExpenseSplit[];
}

function splitMemberIds(split: SplitInput): MemberId[] {
  switch (split.method) {
    case 'equal':
      return [...split.participants];
    case 'exact':
      return split.amounts.map((a) => a.memberId);
    case 'percentage':
      return split.percentages.map((p) => p.memberId);
    case 'shares':
      return split.shares.map((s) => s.memberId);
  }
}

/** Valor ingresado por miembro, para poder editar el gasto sin perder la intención. */
function inputValues(split: SplitInput): Map<MemberId, number | null> {
  switch (split.method) {
    case 'equal':
      return new Map(split.participants.map((id) => [id, null]));
    case 'exact':
      return new Map(split.amounts.map((a) => [a.memberId, a.amount]));
    case 'percentage':
      return new Map(split.percentages.map((p) => [p.memberId, p.basisPoints]));
    case 'shares':
      return new Map(split.shares.map((s) => [s.memberId, s.shares]));
  }
}

const amountOf = (parts: readonly MemberAmount[], index: number) => parts[index]?.amount ?? 0;

export function createExpensesRepository(db: AppDatabase, deps: RepositoryDeps) {
  function listByGroup(groupId: string): ExpenseWithParts[] {
    const rows = db
      .select()
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
      .orderBy(desc(expenses.occurredOn), desc(expenses.id))
      .all();
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.id);
    const payers = db
      .select()
      .from(expensePayers)
      .where(and(inArray(expensePayers.expenseId, ids), isNull(expensePayers.deletedAt)))
      .orderBy(asc(expensePayers.id))
      .all();
    const splits = db
      .select()
      .from(expenseSplits)
      .where(and(inArray(expenseSplits.expenseId, ids), isNull(expenseSplits.deletedAt)))
      .orderBy(asc(expenseSplits.id))
      .all();
    return rows.map((row) => ({
      ...row,
      payers: payers.filter((p) => p.expenseId === row.id),
      splits: splits.filter((s) => s.expenseId === row.id),
    }));
  }

  return {
    /**
     * Registra un gasto o ingreso con sus pagadores y partes.
     *
     * Los montos llegan en unidades menores de `currency`. Si no es la moneda del grupo se
     * exige `exchangeRate`, y el total, los pagadores y las partes se convierten con el
     * dominio: las partes convertidas suman exactamente el total convertido. Todo se guarda
     * en una sola transacción.
     */
    add(input: AddExpenseInput): ExpenseWithParts {
      const data = parse(addExpenseSchema, input);
      const group = requireGroup(db, data.groupId);
      const memberIds = new Set(listMembers(db, group.id).map((m) => m.id));
      const referenced = [...data.payers.map((p) => p.memberId), ...splitMemberIds(data.split)];
      if (referenced.some((memberId) => !memberIds.has(memberId))) {
        throw invalid('Hay miembros que no pertenecen al grupo');
      }
      if (data.categoryId) {
        const category = db
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.id, data.categoryId),
              isNull(categories.deletedAt),
              or(isNull(categories.groupId), eq(categories.groupId, group.id)),
            ),
          )
          .get();
        if (!category) {
          throw invalid('La categoría no existe en este grupo');
        }
      }

      const total = money(data.amount, data.currency);
      const payers = validatePayers(total, data.payers);
      const shares = splitAmount(total, data.split);
      const sameCurrency = data.currency === group.currency;
      if (!sameCurrency && !data.exchangeRate) {
        throw invalid('Falta la tasa de cambio a la moneda del grupo');
      }
      const rate = sameCurrency ? '1' : (data.exchangeRate as string);
      const groupTotal = sameCurrency ? total : convert(total, group.currency, rate);
      const groupPayers = sameCurrency ? payers : convertParts(payers, groupTotal);
      const groupShares = sameCurrency ? shares : convertParts(shares, groupTotal);
      const values = inputValues(data.split);

      return db.transaction((tx) => {
        const now = deps.now();
        const sync = () => ({ id: deps.newId(), createdAt: now, updatedAt: now });
        const expense = tx
          .insert(expenses)
          .values({
            ...sync(),
            groupId: group.id,
            kind: data.kind,
            title: data.title,
            amount: total.amount,
            currency: total.currency,
            groupAmount: groupTotal.amount,
            exchangeRate: rate,
            rateDate: sameCurrency ? null : (data.rateDate ?? null),
            splitMethod: data.split.method,
            categoryId: data.categoryId ?? null,
            occurredOn: data.occurredOn,
            notes: data.notes ?? null,
          })
          .returning()
          .get();
        const payerRows = payers.map((payer, index) =>
          tx
            .insert(expensePayers)
            .values({
              ...sync(),
              expenseId: expense.id,
              memberId: payer.memberId,
              amount: payer.amount,
              groupAmount: amountOf(groupPayers, index),
            })
            .returning()
            .get(),
        );
        const splitRows = shares.map((share, index) =>
          tx
            .insert(expenseSplits)
            .values({
              ...sync(),
              expenseId: expense.id,
              memberId: share.memberId,
              amount: share.amount,
              groupAmount: amountOf(groupShares, index),
              inputValue: values.get(share.memberId) ?? null,
            })
            .returning()
            .get(),
        );
        return { ...expense, payers: payerRows, splits: splitRows };
      });
    },

    /** Gastos e ingresos activos del grupo, del más reciente al más antiguo. */
    listByGroup,

    /** Borrado lógico del gasto, sus pagadores y sus partes, con bloqueo optimista. */
    remove(id: string, expectedVersion: number): void {
      db.transaction((tx) => {
        const now = deps.now();
        const bump = { updatedAt: now, deletedAt: now };
        const [removed] = tx
          .update(expenses)
          .set({ ...bump, version: sql`${expenses.version} + 1` })
          .where(
            and(
              eq(expenses.id, id),
              eq(expenses.version, expectedVersion),
              isNull(expenses.deletedAt),
            ),
          )
          .returning({ id: expenses.id })
          .all();
        if (!removed) {
          const exists = tx
            .select({ id: expenses.id })
            .from(expenses)
            .where(and(eq(expenses.id, id), isNull(expenses.deletedAt)))
            .get();
          throw exists ? conflict('El gasto') : notFound('El gasto');
        }
        tx.update(expensePayers)
          .set({ ...bump, version: sql`${expensePayers.version} + 1` })
          .where(and(eq(expensePayers.expenseId, id), isNull(expensePayers.deletedAt)))
          .run();
        tx.update(expenseSplits)
          .set({ ...bump, version: sql`${expenseSplits.version} + 1` })
          .where(and(eq(expenseSplits.expenseId, id), isNull(expenseSplits.deletedAt)))
          .run();
      });
    },
  };
}
