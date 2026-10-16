import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { GROUP_COLORS } from '@/lib/group-appearance';

import type { TableName } from '../changes';
import { MAX_MINOR_AMOUNT } from '../repositories/validation';
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
import { parseServerInstant } from './instant';
import type { RemoteRow, SyncEntity } from './wire';

/**
 * Aplica a la base local lo que el servidor dice de una unidad. Toda fila que llega de la red se
 * valida aquí con zod antes de tocar SQLite. Las filas conservan los nombres del servidor
 * (snake_case) y sus fechas ISO, que se convierten a milisegundos.
 */

const uuid = z.guid();
const version = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
const money = z.int().min(0).max(MAX_MINOR_AMOUNT);
const currency = z.string().regex(/^[A-Z]{3}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z
  .string()
  .refine((value) => parseServerInstant(value) !== null)
  .transform((value) => parseServerInstant(value) as number);
const rate = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^[0-9][0-9.]*$/));

const groupRow = z.object({
  id: uuid,
  name: z.string().min(1).max(80),
  currency,
  emoji: z.string().nullable(),
  color: z.enum(GROUP_COLORS),
  archived_at: instant.nullable(),
  deleted_at: instant.nullable(),
  version,
});

const memberRow = z.object({
  id: uuid,
  group_id: uuid,
  user_id: uuid.nullable(),
  display_name: z.string().min(1).max(80),
  role: z.enum(['owner', 'member']),
  deleted_at: instant.nullable(),
  version,
});

const categoryRow = z.object({
  id: uuid,
  group_id: uuid.nullable(),
  name: z.string().nullable(),
  icon: z.string(),
  deleted_at: instant.nullable(),
  version,
});

const expenseRow = z.object({
  id: uuid,
  group_id: uuid,
  kind: z.enum(['expense', 'income']),
  title: z.string().min(1).max(120),
  amount: money,
  currency,
  group_currency: currency,
  group_amount: money,
  exchange_rate: rate,
  rate_date: day.nullable(),
  split_method: z.enum(['equal', 'exact', 'percentage', 'shares']),
  category_id: uuid.nullable(),
  occurred_on: day,
  notes: z.string().nullable(),
  deleted_at: instant.nullable(),
  version,
});

const payerRow = z.object({
  id: uuid,
  expense_id: uuid,
  member_id: uuid,
  amount: money,
  group_amount: money,
  deleted_at: instant.nullable(),
  version,
});

const splitRow = payerRow.extend({ input_value: money.nullable() });

const transferRow = z.object({
  id: uuid,
  group_id: uuid,
  from_member_id: uuid,
  to_member_id: uuid,
  amount: money,
  currency,
  group_currency: currency,
  group_amount: money,
  exchange_rate: rate,
  rate_date: day.nullable(),
  occurred_on: day,
  deleted_at: instant.nullable(),
  version,
});

type GroupRow = z.output<typeof groupRow>;
type MemberRow = z.output<typeof memberRow>;
type CategoryRow = z.output<typeof categoryRow>;
type ExpenseRow = z.output<typeof expenseRow>;
type PayerRow = z.output<typeof payerRow>;
type SplitRow = z.output<typeof splitRow>;
type TransferRow = z.output<typeof transferRow>;

/** Las filas del servidor de una unidad, validadas y agrupadas por tabla. */
export interface ParsedRows {
  readonly groups: GroupRow[];
  readonly members: MemberRow[];
  readonly categories: CategoryRow[];
  readonly expenses: ExpenseRow[];
  readonly payers: PayerRow[];
  readonly splits: SplitRow[];
  readonly transfers: TransferRow[];
}

/** El mensaje es fijo: nunca lleva lo que contestó el servidor. */
export class RemoteRowError extends Error {
  constructor() {
    super('Una fila del servidor no cumple el contrato');
    this.name = 'RemoteRowError';
  }
}

function must<T>(schema: z.ZodType<T>, row: unknown): T {
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    throw new RemoteRowError();
  }
  return parsed.data;
}

export function parseRemoteRows(rows: readonly RemoteRow[]): ParsedRows {
  const parsed: {
    -readonly [K in keyof ParsedRows]: ParsedRows[K];
  } = {
    groups: [],
    members: [],
    categories: [],
    expenses: [],
    payers: [],
    splits: [],
    transfers: [],
  };
  for (const { table, row } of rows) {
    switch (table) {
      case 'groups':
        parsed.groups.push(must(groupRow, row));
        break;
      case 'group_members':
        parsed.members.push(must(memberRow, row));
        break;
      case 'categories':
        parsed.categories.push(must(categoryRow, row));
        break;
      case 'expenses':
        parsed.expenses.push(must(expenseRow, row));
        break;
      case 'expense_payers':
        parsed.payers.push(must(payerRow, row));
        break;
      case 'expense_splits':
        parsed.splits.push(must(splitRow, row));
        break;
      case 'transfers':
        parsed.transfers.push(must(transferRow, row));
        break;
    }
  }
  return parsed;
}

/** Tablas locales que toca una unidad, para avisar en el bus de cambios. */
export function tablesOf(entity: SyncEntity): TableName[] {
  switch (entity) {
    case 'group':
      return ['groups'];
    case 'member':
      return ['group_members'];
    case 'category':
      return ['categories'];
    case 'expense':
      return ['expenses', 'expense_payers', 'expense_splits'];
    case 'transfer':
      return ['transfers'];
  }
}

/** La fila principal que el servidor devolvió para la unidad, si la devolvió. */
export function serverRoot(
  rows: ParsedRows,
  entity: SyncEntity,
  id: string,
): { readonly deletedAt: number | null } | undefined {
  const list: readonly { id: string; deleted_at: number | null }[] = {
    group: rows.groups,
    member: rows.members,
    category: rows.categories,
    expense: rows.expenses,
    transfer: rows.transfers,
  }[entity];
  const root = list.find((row) => row.id === id);
  return root && { deletedAt: root.deleted_at };
}

/**
 * Reemplaza la unidad local por el estado del servidor. Sube la `version` local (un formulario
 * abierto sobre la anterior da CONFLICT) y deja la unidad al día. Lanza si el servidor no
 * devolvió la fila principal o si algo choca con la base; quien llama lo hace dentro de una
 * transacción para deshacer todo.
 */
export function replaceUnitFromServer(
  tx: AppDatabase,
  entity: SyncEntity,
  id: string,
  rows: ParsedRows,
  now: number,
): void {
  switch (entity) {
    case 'group': {
      const r = rows.groups.find((row) => row.id === id);
      if (!r) {
        throw new RemoteRowError();
      }
      tx.update(groups)
        .set({
          name: r.name,
          currency: r.currency,
          emoji: r.emoji,
          color: r.color,
          archivedAt: r.archived_at,
          deletedAt: r.deleted_at,
          updatedAt: now,
          version: sql`${groups.version} + 1`,
          syncedVersion: sql`${groups.version} + 1`,
          serverVersion: r.version,
        })
        .where(eq(groups.id, id))
        .run();
      return;
    }
    case 'member': {
      const r = rows.members.find((row) => row.id === id);
      if (!r) {
        throw new RemoteRowError();
      }
      tx.update(groupMembers)
        .set({
          displayName: r.display_name,
          userId: r.user_id,
          role: r.role,
          deletedAt: r.deleted_at,
          updatedAt: now,
          version: sql`${groupMembers.version} + 1`,
          syncedVersion: sql`${groupMembers.version} + 1`,
          serverVersion: r.version,
        })
        .where(eq(groupMembers.id, id))
        .run();
      return;
    }
    case 'category': {
      const r = rows.categories.find((row) => row.id === id);
      if (!r) {
        throw new RemoteRowError();
      }
      tx.update(categories)
        .set({
          name: r.name,
          icon: r.icon,
          deletedAt: r.deleted_at,
          updatedAt: now,
          version: sql`${categories.version} + 1`,
          syncedVersion: sql`${categories.version} + 1`,
          serverVersion: r.version,
        })
        .where(eq(categories.id, id))
        .run();
      return;
    }
    case 'expense': {
      const r = rows.expenses.find((row) => row.id === id);
      if (!r) {
        throw new RemoteRowError();
      }
      tx.update(expenses)
        .set({
          groupCurrency: r.group_currency,
          kind: r.kind,
          title: r.title,
          amount: r.amount,
          currency: r.currency,
          groupAmount: r.group_amount,
          exchangeRate: r.exchange_rate,
          rateDate: r.rate_date,
          splitMethod: r.split_method,
          categoryId: r.category_id,
          occurredOn: r.occurred_on,
          notes: r.notes,
          deletedAt: r.deleted_at,
          updatedAt: now,
          version: sql`${expenses.version} + 1`,
          syncedVersion: sql`${expenses.version} + 1`,
          serverVersion: r.version,
        })
        .where(eq(expenses.id, id))
        .run();
      reconcilePayers(
        tx,
        id,
        rows.payers.filter((p) => p.expense_id === id),
        now,
      );
      reconcileSplits(
        tx,
        id,
        rows.splits.filter((p) => p.expense_id === id),
        now,
      );
      return;
    }
    case 'transfer': {
      const r = rows.transfers.find((row) => row.id === id);
      if (!r) {
        throw new RemoteRowError();
      }
      tx.update(transfers)
        .set({
          groupCurrency: r.group_currency,
          fromMemberId: r.from_member_id,
          toMemberId: r.to_member_id,
          amount: r.amount,
          currency: r.currency,
          groupAmount: r.group_amount,
          exchangeRate: r.exchange_rate,
          rateDate: r.rate_date,
          occurredOn: r.occurred_on,
          deletedAt: r.deleted_at,
          updatedAt: now,
          version: sql`${transfers.version} + 1`,
          syncedVersion: sql`${transfers.version} + 1`,
          serverVersion: r.version,
        })
        .where(eq(transfers.id, id))
        .run();
      return;
    }
  }
}

/**
 * Pagadores del gasto igual que en el servidor. Primero se borran los activos que el servidor ya
 * no tiene, después se aplican los borrados y al final los activos: el índice único (gasto, miembro)
 * solo cuenta los activos.
 */
function reconcilePayers(tx: AppDatabase, expenseId: string, server: PayerRow[], now: number) {
  const activeIds = server.filter((p) => p.deleted_at === null).map((p) => p.id);
  tx.update(expensePayers)
    .set({
      deletedAt: now,
      updatedAt: now,
      version: sql`${expensePayers.version} + 1`,
    })
    .where(
      and(
        eq(expensePayers.expenseId, expenseId),
        isNull(expensePayers.deletedAt),
        activeIds.length > 0 ? notInArray(expensePayers.id, activeIds) : undefined,
      ),
    )
    .run();
  const ordered = [
    ...server.filter((p) => p.deleted_at !== null),
    ...server.filter((p) => p.deleted_at === null),
  ];
  for (const p of ordered) {
    const values = {
      memberId: p.member_id,
      amount: p.amount,
      groupAmount: p.group_amount,
      deletedAt: p.deleted_at,
      serverVersion: p.version,
    };
    const exists = tx
      .select({ id: expensePayers.id })
      .from(expensePayers)
      .where(eq(expensePayers.id, p.id))
      .get();
    if (exists) {
      tx.update(expensePayers)
        .set({ ...values, updatedAt: now, version: sql`${expensePayers.version} + 1` })
        .where(eq(expensePayers.id, p.id))
        .run();
    } else {
      tx.insert(expensePayers)
        .values({ id: p.id, expenseId, createdAt: now, updatedAt: now, ...values })
        .run();
    }
  }
  tx.update(expensePayers)
    .set({ syncedVersion: sql`${expensePayers.version}` })
    .where(eq(expensePayers.expenseId, expenseId))
    .run();
}

function reconcileSplits(tx: AppDatabase, expenseId: string, server: SplitRow[], now: number) {
  const activeIds = server.filter((p) => p.deleted_at === null).map((p) => p.id);
  tx.update(expenseSplits)
    .set({
      deletedAt: now,
      updatedAt: now,
      version: sql`${expenseSplits.version} + 1`,
    })
    .where(
      and(
        eq(expenseSplits.expenseId, expenseId),
        isNull(expenseSplits.deletedAt),
        activeIds.length > 0 ? notInArray(expenseSplits.id, activeIds) : undefined,
      ),
    )
    .run();
  const ordered = [
    ...server.filter((p) => p.deleted_at !== null),
    ...server.filter((p) => p.deleted_at === null),
  ];
  for (const p of ordered) {
    const values = {
      memberId: p.member_id,
      amount: p.amount,
      groupAmount: p.group_amount,
      inputValue: p.input_value,
      deletedAt: p.deleted_at,
      serverVersion: p.version,
    };
    const exists = tx
      .select({ id: expenseSplits.id })
      .from(expenseSplits)
      .where(eq(expenseSplits.id, p.id))
      .get();
    if (exists) {
      tx.update(expenseSplits)
        .set({ ...values, updatedAt: now, version: sql`${expenseSplits.version} + 1` })
        .where(eq(expenseSplits.id, p.id))
        .run();
    } else {
      tx.insert(expenseSplits)
        .values({ id: p.id, expenseId, createdAt: now, updatedAt: now, ...values })
        .run();
    }
  }
  tx.update(expenseSplits)
    .set({ syncedVersion: sql`${expenseSplits.version}` })
    .where(eq(expenseSplits.expenseId, expenseId))
    .run();
}

/**
 * Borrado lógico local de un movimiento que el servidor nunca tuvo y rechazó. Queda al día (no se
 * vuelve a enviar) y sus datos completos viven en el borrador.
 */
export function removeNewMovementLocally(
  tx: AppDatabase,
  entity: 'expense' | 'transfer',
  id: string,
  now: number,
): void {
  if (entity === 'transfer') {
    tx.update(transfers)
      .set({
        deletedAt: now,
        updatedAt: now,
        version: sql`${transfers.version} + 1`,
        syncedVersion: sql`${transfers.version} + 1`,
      })
      .where(eq(transfers.id, id))
      .run();
    return;
  }
  tx.update(expenses)
    .set({
      deletedAt: now,
      updatedAt: now,
      version: sql`${expenses.version} + 1`,
      syncedVersion: sql`${expenses.version} + 1`,
    })
    .where(eq(expenses.id, id))
    .run();
  tx.update(expensePayers)
    .set({ deletedAt: now, updatedAt: now, version: sql`${expensePayers.version} + 1` })
    .where(and(eq(expensePayers.expenseId, id), isNull(expensePayers.deletedAt)))
    .run();
  tx.update(expenseSplits)
    .set({ deletedAt: now, updatedAt: now, version: sql`${expenseSplits.version} + 1` })
    .where(and(eq(expenseSplits.expenseId, id), isNull(expenseSplits.deletedAt)))
    .run();
  tx.update(expensePayers)
    .set({ syncedVersion: sql`${expensePayers.version}` })
    .where(eq(expensePayers.expenseId, id))
    .run();
  tx.update(expenseSplits)
    .set({ syncedVersion: sql`${expenseSplits.version}` })
    .where(eq(expenseSplits.expenseId, id))
    .run();
}
