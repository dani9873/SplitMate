import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

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

import type { TableName } from '../changes';
import { categories, expensePayers, expenseSplits, expenses } from '../schema';
import { conflict, invalid, notFound, parse } from './errors';
import { listMembers, requireWritableGroup, type Group } from './queries';
import type { AppDatabase, RepositoryContext } from './types';
import { addExpenseSchema, type AddExpenseInput } from './validation';

export type Expense = typeof expenses.$inferSelect;
export type ExpensePayer = typeof expensePayers.$inferSelect;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;
export interface ExpenseWithParts extends Expense {
  readonly payers: ExpensePayer[];
  readonly splits: ExpenseSplit[];
}

const EXPENSE_TABLES: readonly TableName[] = ['expenses', 'expense_payers', 'expense_splits'];

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

function attachParts(db: AppDatabase, rows: Expense[]): ExpenseWithParts[] {
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

/** Gastos e ingresos activos de un grupo, del más reciente al más antiguo. */
export function listExpensesWithParts(db: AppDatabase, groupId?: string): ExpenseWithParts[] {
  const rows = db
    .select()
    .from(expenses)
    .where(
      and(
        groupId === undefined ? undefined : eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
      ),
    )
    .orderBy(desc(expenses.occurredOn), desc(expenses.id))
    .all();
  return attachParts(db, rows);
}

/** Montos en la moneda original y en la del grupo, listos para insertar. */
interface PreparedExpense {
  readonly data: ReturnType<typeof addExpenseSchema.parse>;
  readonly values: Omit<typeof expenses.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
  readonly payers: readonly MemberAmount[];
  readonly shares: readonly MemberAmount[];
  readonly groupPayers: readonly MemberAmount[];
  readonly groupShares: readonly MemberAmount[];
  readonly inputs: Map<MemberId, number | null>;
}

/**
 * Valida la entrada contra el grupo y calcula partes y conversiones con el dominio.
 * `allowedMemberIds` son los miembros que puede mencionar: los activos y, al editar, también
 * los quitados que ya estaban en el gasto.
 */
function prepareExpense(
  db: AppDatabase,
  group: Group,
  data: ReturnType<typeof addExpenseSchema.parse>,
  allowedMemberIds: ReadonlySet<string>,
): PreparedExpense {
  const referenced = [...data.payers.map((p) => p.memberId), ...splitMemberIds(data.split)];
  if (referenced.some((memberId) => !allowedMemberIds.has(memberId))) {
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
  return {
    data,
    values: {
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
    },
    payers,
    shares,
    groupPayers: sameCurrency ? payers : convertParts(payers, groupTotal),
    groupShares: sameCurrency ? shares : convertParts(shares, groupTotal),
    inputs: inputValues(data.split),
  };
}

export function createExpensesRepository(ctx: RepositoryContext) {
  const { db, deps } = ctx;

  /** Inserta pagadores y partes de un gasto dentro de la transacción `tx`. */
  function insertParts(tx: AppDatabase, expenseId: string, prepared: PreparedExpense, now: number) {
    const sync = () => ({ id: deps.newId(), createdAt: now, updatedAt: now });
    const payerRows = prepared.payers.map((payer, index) =>
      tx
        .insert(expensePayers)
        .values({
          ...sync(),
          expenseId,
          memberId: payer.memberId,
          amount: payer.amount,
          groupAmount: amountOf(prepared.groupPayers, index),
        })
        .returning()
        .get(),
    );
    const splitRows = prepared.shares.map((share, index) =>
      tx
        .insert(expenseSplits)
        .values({
          ...sync(),
          expenseId,
          memberId: share.memberId,
          amount: share.amount,
          groupAmount: amountOf(prepared.groupShares, index),
          inputValue: prepared.inputs.get(share.memberId) ?? null,
        })
        .returning()
        .get(),
    );
    return { payers: payerRows, splits: splitRows };
  }

  /** Borra lógicamente pagadores y partes activos del gasto con el instante `now`. */
  function deleteParts(tx: AppDatabase, expenseId: string, now: number) {
    const bump = { updatedAt: now, deletedAt: now };
    tx.update(expensePayers)
      .set({ ...bump, version: sql`${expensePayers.version} + 1` })
      .where(and(eq(expensePayers.expenseId, expenseId), isNull(expensePayers.deletedAt)))
      .run();
    tx.update(expenseSplits)
      .set({ ...bump, version: sql`${expenseSplits.version} + 1` })
      .where(and(eq(expenseSplits.expenseId, expenseId), isNull(expenseSplits.deletedAt)))
      .run();
  }

  function findExpense(id: string, deleted: boolean): Expense | undefined {
    return db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.id, id),
          deleted ? isNotNull(expenses.deletedAt) : isNull(expenses.deletedAt),
        ),
      )
      .get();
  }

  function get(id: string): ExpenseWithParts | undefined {
    const row = findExpense(id, false);
    return row ? attachParts(db, [row])[0] : undefined;
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
      const group = requireWritableGroup(db, data.groupId);
      const active = new Set(listMembers(db, group.id).map((m) => m.id));
      const prepared = prepareExpense(db, group, data, active);
      const result = db.transaction((tx) => {
        const now = deps.now();
        const expense = tx
          .insert(expenses)
          .values({ id: deps.newId(), createdAt: now, updatedAt: now, ...prepared.values })
          .returning()
          .get();
        return { ...expense, ...insertParts(tx, expense.id, prepared, now) };
      });
      ctx.notify(EXPENSE_TABLES, [group.id]);
      return result;
    },

    get,

    /**
     * Reemplaza el gasto con bloqueo optimista: actualiza la fila, borra lógicamente sus
     * pagadores y partes y crea los nuevos. Puede seguir mencionando a miembros quitados que
     * ya estaban en el gasto, pero no sumar otros.
     */
    update(id: string, expectedVersion: number, input: AddExpenseInput): ExpenseWithParts {
      const data = parse(addExpenseSchema, input);
      const current = get(id);
      if (!current) {
        throw notFound('El gasto');
      }
      if (data.groupId !== current.groupId) {
        throw invalid('Un gasto no cambia de grupo');
      }
      const group = requireWritableGroup(db, current.groupId);
      const allowed = new Set([
        ...listMembers(db, group.id).map((m) => m.id),
        ...current.payers.map((p) => p.memberId),
        ...current.splits.map((s) => s.memberId),
      ]);
      const prepared = prepareExpense(db, group, data, allowed);
      const result = db.transaction((tx) => {
        const now = deps.now();
        const [expense] = tx
          .update(expenses)
          .set({ ...prepared.values, updatedAt: now, version: sql`${expenses.version} + 1` })
          .where(
            and(
              eq(expenses.id, id),
              eq(expenses.version, expectedVersion),
              isNull(expenses.deletedAt),
            ),
          )
          .returning()
          .all();
        if (!expense) {
          throw conflict('El gasto');
        }
        deleteParts(tx, id, now);
        return { ...expense, ...insertParts(tx, id, prepared, now) };
      });
      ctx.notify(EXPENSE_TABLES, [group.id]);
      return result;
    },

    /** Gastos e ingresos activos del grupo, del más reciente al más antiguo. */
    listByGroup(groupId: string): ExpenseWithParts[] {
      return listExpensesWithParts(db, groupId);
    },

    /** Borrado lógico del gasto, sus pagadores y sus partes, con bloqueo optimista. */
    remove(id: string, expectedVersion: number): void {
      const current = findExpense(id, false);
      if (!current) {
        throw notFound('El gasto');
      }
      requireWritableGroup(db, current.groupId);
      db.transaction((tx) => {
        const now = deps.now();
        const [removed] = tx
          .update(expenses)
          .set({ updatedAt: now, deletedAt: now, version: sql`${expenses.version} + 1` })
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
          throw conflict('El gasto');
        }
        deleteParts(tx, id, now);
      });
      ctx.notify(EXPENSE_TABLES, [current.groupId]);
    },

    /**
     * Deshace un borrado: el gasto y las filas hijas borradas en ese mismo instante vuelven a
     * estar activos, con nueva `version`. Las partes que reemplazó una edición anterior siguen
     * borradas.
     */
    restore(id: string, expectedVersion: number): void {
      const removed = findExpense(id, true);
      if (!removed) {
        throw notFound('El gasto borrado');
      }
      requireWritableGroup(db, removed.groupId);
      const deletedAt = removed.deletedAt as number;
      db.transaction((tx) => {
        const now = deps.now();
        const restore = { updatedAt: now, deletedAt: null };
        const [restored] = tx
          .update(expenses)
          .set({ ...restore, version: sql`${expenses.version} + 1` })
          .where(and(eq(expenses.id, id), eq(expenses.version, expectedVersion)))
          .returning({ id: expenses.id })
          .all();
        if (!restored) {
          throw conflict('El gasto');
        }
        tx.update(expensePayers)
          .set({ ...restore, version: sql`${expensePayers.version} + 1` })
          .where(and(eq(expensePayers.expenseId, id), eq(expensePayers.deletedAt, deletedAt)))
          .run();
        tx.update(expenseSplits)
          .set({ ...restore, version: sql`${expenseSplits.version} + 1` })
          .where(and(eq(expenseSplits.expenseId, id), eq(expenseSplits.deletedAt, deletedAt)))
          .run();
      });
      ctx.notify(EXPENSE_TABLES, [removed.groupId]);
    },
  };
}
