import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { GROUP_COLORS, MAX_EMOJI_LENGTH } from '@/lib/group-appearance';

import type { TableName } from '../changes';
import {
  currencySchema,
  isoDateSchema,
  MAX_MINOR_AMOUNT,
  rateSchema,
} from '../repositories/validation';
import type { AppDatabase } from '../repositories/types';
import {
  categories,
  expensePayers,
  expenses,
  expenseSplits,
  groupAccess,
  groupMembers,
  groups,
  syncOutbox,
  transfers,
  users,
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
/** Solo monedas que la app conoce: otro código rompería los saldos (`currencyCode` lanza). */
const currency = currencySchema;
const day = isoDateSchema;
const instant = z
  .string()
  .refine((value) => parseServerInstant(value) !== null)
  .transform((value) => parseServerInstant(value) as number);
const rate = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(rateSchema.refine((value) => /[1-9]/.test(value), 'Tasa mayor que cero'));

/**
 * Textos con los topes de sync_push. zod cuenta caracteres, como `char_length` en Postgres y
 * `length` en SQLite: una fila que el servidor aceptó no se rechaza aquí por su largo.
 */
const text = (max: number) => z.string().min(1).max(max);

/** Fechas del servidor: opcionales, porque solo sirven para fechar una fila que llega nueva. */
const stamps = { created_at: instant.optional(), updated_at: instant.optional() };

const groupRow = z.object({
  ...stamps,
  id: uuid,
  /**
   * Solo hace falta al insertar el grupo; una edición no lo toca. Nulo si la cuenta de quien lo creó
   * se borró (el servidor deja el grupo a las demás cuentas).
   */
  created_by: uuid.nullable().optional(),
  name: text(80),
  currency,
  emoji: text(MAX_EMOJI_LENGTH).nullable(),
  color: z.enum(GROUP_COLORS),
  archived_at: instant.nullable(),
  deleted_at: instant.nullable(),
  version,
});

/** Quién tiene acceso a un grupo. Solo bajada: la app nunca la edita. */
const accessRow = z.object({
  ...stamps,
  id: uuid,
  group_id: uuid,
  user_id: uuid,
  role: z.enum(['owner', 'member']),
  invitation_id: uuid.nullable(),
  deleted_at: instant.nullable(),
  version,
});

const memberRow = z.object({
  ...stamps,
  id: uuid,
  group_id: uuid,
  user_id: uuid.nullable(),
  display_name: text(80),
  role: z.enum(['owner', 'member']),
  deleted_at: instant.nullable(),
  version,
});

const categoryRow = z.object({
  ...stamps,
  id: uuid,
  group_id: uuid.nullable(),
  name: text(40).nullable(),
  icon: text(40),
  deleted_at: instant.nullable(),
  version,
});

const expenseRow = z.object({
  ...stamps,
  id: uuid,
  group_id: uuid,
  kind: z.enum(['expense', 'income']),
  title: text(120),
  amount: money,
  currency,
  group_currency: currency,
  group_amount: money,
  exchange_rate: rate,
  rate_date: day.nullable(),
  split_method: z.enum(['equal', 'exact', 'percentage', 'shares']),
  category_id: uuid.nullable(),
  occurred_on: day,
  notes: text(1000).nullable(),
  deleted_at: instant.nullable(),
  version,
});

const payerRow = z.object({
  ...stamps,
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
  ...stamps,
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

export type GroupRow = z.output<typeof groupRow>;
export type AccessRow = z.output<typeof accessRow>;
export type MemberRow = z.output<typeof memberRow>;
export type CategoryRow = z.output<typeof categoryRow>;
export type ExpenseRow = z.output<typeof expenseRow>;
export type PayerRow = z.output<typeof payerRow>;
export type SplitRow = z.output<typeof splitRow>;
export type TransferRow = z.output<typeof transferRow>;

/** Las filas del servidor de una unidad, validadas y agrupadas por tabla. */
export interface ParsedRows {
  readonly groups: GroupRow[];
  readonly access: AccessRow[];
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

type MutableParsed = { -readonly [K in keyof ParsedRows]: ParsedRows[K] };

const emptyParsed = (): MutableParsed => ({
  groups: [],
  access: [],
  members: [],
  categories: [],
  expenses: [],
  payers: [],
  splits: [],
  transfers: [],
});

/** Valida una fila con su esquema y la agrega a su lista. Lanza RemoteRowError si no cumple. */
function addRow(parsed: MutableParsed, { table, row }: RemoteRow): void {
  const check = <T>(schema: z.ZodType<T>, into: T[]) => {
    const result = schema.safeParse(row);
    if (!result.success) {
      throw new RemoteRowError();
    }
    into.push(result.data);
  };
  switch (table) {
    case 'groups':
      return check(groupRow, parsed.groups);
    case 'group_access':
      return check(accessRow, parsed.access);
    case 'group_members':
      return check(memberRow, parsed.members);
    case 'categories':
      return check(categoryRow, parsed.categories);
    case 'expenses':
      return check(expenseRow, parsed.expenses);
    case 'expense_payers':
      return check(payerRow, parsed.payers);
    case 'expense_splits':
      return check(splitRow, parsed.splits);
    case 'transfers':
      return check(transferRow, parsed.transfers);
  }
}

/** Valida todas las filas; la primera que no cumple el contrato lanza RemoteRowError. */
export function parseRemoteRows(rows: readonly RemoteRow[]): ParsedRows {
  const parsed = emptyParsed();
  for (const row of rows) {
    addRow(parsed, row);
  }
  return parsed;
}

/**
 * Valida fila por fila para la descarga: una fila inválida se descarta (sin tocar SQLite) y se
 * cuenta, y el resto del lote sigue.
 */
export function parseRemoteRowsLenient(rows: readonly RemoteRow[]): {
  readonly rows: ParsedRows;
  readonly invalid: number;
} {
  const parsed = emptyParsed();
  let invalid = 0;
  for (const row of rows) {
    try {
      addRow(parsed, row);
    } catch {
      invalid += 1;
    }
  }
  return { rows: parsed, invalid };
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
 * Inserta una unidad que el servidor tiene y esta base no. Queda al día (`version` 1 = `synced_version`
 * 1) con la versión del servidor anotada. Lanza si falta la fila principal o algo choca con la base
 * (por ejemplo, un padre que todavía no llegó); quien llama lo hace dentro de un punto de guardado.
 */
export function insertUnitFromServer(
  tx: AppDatabase,
  entity: SyncEntity,
  id: string,
  rows: ParsedRows,
  now: number,
): void {
  switch (entity) {
    case 'group': {
      const r = rows.groups.find((row) => row.id === id);
      if (!r || r.created_by === undefined) {
        throw new RemoteRowError();
      }
      tx.insert(groups)
        .values({
          id,
          createdAt: r.created_at ?? now,
          updatedAt: r.updated_at ?? now,
          deletedAt: r.deleted_at,
          version: 1,
          syncedVersion: 1,
          serverVersion: r.version,
          name: r.name,
          currency: r.currency,
          createdBy: r.created_by ?? DELETED_ACCOUNT_ID,
          emoji: r.emoji,
          color: r.color,
          archivedAt: r.archived_at,
        })
        .run();
      return;
    }
    case 'member': {
      const r = rows.members.find((row) => row.id === id);
      if (!r) {
        throw new RemoteRowError();
      }
      tx.insert(groupMembers)
        .values({
          id,
          createdAt: r.created_at ?? now,
          updatedAt: r.updated_at ?? now,
          deletedAt: r.deleted_at,
          version: 1,
          syncedVersion: 1,
          serverVersion: r.version,
          groupId: r.group_id,
          userId: r.user_id,
          displayName: r.display_name,
          role: r.role,
        })
        .run();
      return;
    }
    case 'category': {
      const r = rows.categories.find((row) => row.id === id);
      if (!r?.group_id) {
        throw new RemoteRowError();
      }
      tx.insert(categories)
        .values({
          id,
          createdAt: r.created_at ?? now,
          updatedAt: r.updated_at ?? now,
          deletedAt: r.deleted_at,
          version: 1,
          syncedVersion: 1,
          serverVersion: r.version,
          groupId: r.group_id,
          key: null,
          name: r.name,
          icon: r.icon,
        })
        .run();
      return;
    }
    case 'expense': {
      const r = rows.expenses.find((row) => row.id === id);
      if (!r) {
        throw new RemoteRowError();
      }
      tx.insert(expenses)
        .values({
          id,
          createdAt: r.created_at ?? now,
          updatedAt: r.updated_at ?? now,
          deletedAt: r.deleted_at,
          version: 1,
          syncedVersion: 1,
          serverVersion: r.version,
          groupId: r.group_id,
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
        })
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
      tx.insert(transfers)
        .values({
          id,
          createdAt: r.created_at ?? now,
          updatedAt: r.updated_at ?? now,
          deletedAt: r.deleted_at,
          version: 1,
          syncedVersion: 1,
          serverVersion: r.version,
          groupId: r.group_id,
          groupCurrency: r.group_currency,
          fromMemberId: r.from_member_id,
          toMemberId: r.to_member_id,
          amount: r.amount,
          currency: r.currency,
          groupAmount: r.group_amount,
          exchangeRate: r.exchange_rate,
          rateDate: r.rate_date,
          occurredOn: r.occurred_on,
        })
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

/** Nombre de relleno de las cuentas ajenas: nunca se muestra (a las personas se las nombra por su miembro). */
export const REMOTE_USER_NAME = '?';

/** La «creadora» de un grupo cuya cuenta se borró: un usuario remoto fijo, para la clave foránea. */
export const DELETED_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Las cuentas ajenas que mencionan las filas (creadora del grupo, cuenta de un miembro, dueña de un
 * acceso) entran como usuarios remotos mínimos: así las claves foráneas locales valen sin reconstruir
 * tablas. Las que ya existen no se tocan.
 */
export function ensureRemoteUsers(tx: AppDatabase, rows: ParsedRows, now: number): void {
  const wanted = new Set<string>();
  for (const row of rows.groups) {
    if (row.created_by !== undefined) {
      wanted.add(row.created_by ?? DELETED_ACCOUNT_ID);
    }
  }
  for (const row of rows.members) {
    if (row.user_id) {
      wanted.add(row.user_id);
    }
  }
  for (const row of rows.access) {
    wanted.add(row.user_id);
  }
  const ids = [...wanted];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    for (const row of tx
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, chunk))
      .all()) {
      known.add(row.id);
    }
  }
  for (const id of ids) {
    if (!known.has(id)) {
      tx.insert(users)
        .values({
          id,
          createdAt: now,
          updatedAt: now,
          displayName: REMOTE_USER_NAME,
          email: null,
          isRemote: true,
        })
        .run();
    }
  }
}

/**
 * Aplica una fila de `group_access`: se inserta, o reemplaza a la que ya hay si el servidor trae una
 * versión más nueva. Si el servidor recreó el acceso de la cuenta con otro id (borró la fila al
 * borrar la cuenta y volvió a crearla), la fila vieja se quita: es solo bajada, no se pierde nada.
 */
export function applyAccessRow(
  tx: AppDatabase,
  r: AccessRow,
  now: number,
): 'applied' | 'unchanged' {
  const existing = tx.select().from(groupAccess).where(eq(groupAccess.id, r.id)).get();
  if (existing) {
    if (existing.groupId !== r.group_id || existing.userId !== r.user_id) {
      throw new RemoteRowError();
    }
    if (r.version <= existing.version) {
      return 'unchanged';
    }
    tx.update(groupAccess)
      .set({
        role: r.role,
        invitationId: r.invitation_id,
        deletedAt: r.deleted_at,
        updatedAt: r.updated_at ?? now,
        version: r.version,
      })
      .where(eq(groupAccess.id, r.id))
      .run();
    return 'applied';
  }
  tx.delete(groupAccess)
    .where(and(eq(groupAccess.groupId, r.group_id), eq(groupAccess.userId, r.user_id)))
    .run();
  tx.insert(groupAccess)
    .values({
      id: r.id,
      groupId: r.group_id,
      userId: r.user_id,
      role: r.role,
      invitationId: r.invitation_id,
      createdAt: r.created_at ?? now,
      updatedAt: r.updated_at ?? now,
      deletedAt: r.deleted_at,
      version: r.version,
    })
    .run();
  return 'applied';
}

/**
 * C4: las unidades del lote cuyo id ya existe en el teléfono con otro grupo (o, en un pagador o una
 * parte, con otro gasto). El servidor nunca cambia esos campos: una diferencia es un dato corrupto o
 * malicioso. Devuelve las claves `entidad:id` de las unidades que no deben aplicarse, y los ids de
 * las filas de acceso con ese problema.
 */
export function findIdConflicts(
  tx: AppDatabase,
  rows: ParsedRows,
): { readonly units: Set<string>; readonly access: Set<string> } {
  const units = new Set<string>();
  const access = new Set<string>();
  const check = <T extends { id: string }>(
    list: readonly T[],
    load: (ids: string[]) => { id: string; owner: string | null }[],
    ownerOf: (row: T) => string | null,
    onBad: (row: T) => void,
  ) => {
    for (let i = 0; i < list.length; i += 400) {
      const chunk = list.slice(i, i + 400);
      const local = new Map(load(chunk.map((row) => row.id)).map((row) => [row.id, row.owner]));
      for (const row of chunk) {
        if (local.has(row.id) && local.get(row.id) !== ownerOf(row)) {
          onBad(row);
        }
      }
    }
  };
  check(
    rows.members,
    (ids) =>
      tx
        .select({ id: groupMembers.id, owner: groupMembers.groupId })
        .from(groupMembers)
        .where(inArray(groupMembers.id, ids))
        .all(),
    (row) => row.group_id,
    (row) => units.add(`member:${row.id}`),
  );
  check(
    rows.categories,
    (ids) =>
      tx
        .select({ id: categories.id, owner: categories.groupId })
        .from(categories)
        .where(inArray(categories.id, ids))
        .all(),
    (row) => row.group_id,
    (row) => units.add(`category:${row.id}`),
  );
  check(
    rows.expenses,
    (ids) =>
      tx
        .select({ id: expenses.id, owner: expenses.groupId })
        .from(expenses)
        .where(inArray(expenses.id, ids))
        .all(),
    (row) => row.group_id,
    (row) => units.add(`expense:${row.id}`),
  );
  check(
    rows.transfers,
    (ids) =>
      tx
        .select({ id: transfers.id, owner: transfers.groupId })
        .from(transfers)
        .where(inArray(transfers.id, ids))
        .all(),
    (row) => row.group_id,
    (row) => units.add(`transfer:${row.id}`),
  );
  check(
    rows.payers,
    (ids) =>
      tx
        .select({ id: expensePayers.id, owner: expensePayers.expenseId })
        .from(expensePayers)
        .where(inArray(expensePayers.id, ids))
        .all(),
    (row) => row.expense_id,
    (row) => units.add(`expense:${row.expense_id}`),
  );
  check(
    rows.splits,
    (ids) =>
      tx
        .select({ id: expenseSplits.id, owner: expenseSplits.expenseId })
        .from(expenseSplits)
        .where(inArray(expenseSplits.id, ids))
        .all(),
    (row) => row.expense_id,
    (row) => units.add(`expense:${row.expense_id}`),
  );
  check(
    rows.access,
    (ids) =>
      tx
        .select({ id: groupAccess.id, owner: groupAccess.groupId })
        .from(groupAccess)
        .where(inArray(groupAccess.id, ids))
        .all(),
    (row) => row.group_id,
    (row) => access.add(row.id),
  );
  return { units, access };
}

/**
 * Cuando el servidor rechazó por un cupo algo que el usuario creó (un grupo, un miembro o una
 * categoría que nunca llegó), la unidad se quita de la vista y queda al día para no volver a
 * enviarse: lo creado vive en el borrador. En un grupo nuevo se quita también todo lo que colgaba
 * de él.
 */
export function removeNewUnitLocally(
  tx: AppDatabase,
  entity: 'group' | 'member' | 'category',
  id: string,
  now: number,
): void {
  switch (entity) {
    case 'member':
      tx.update(groupMembers)
        .set({
          deletedAt: now,
          updatedAt: now,
          version: sql`${groupMembers.version} + 1`,
          syncedVersion: sql`${groupMembers.version} + 1`,
        })
        .where(eq(groupMembers.id, id))
        .run();
      return;
    case 'category':
      tx.update(categories)
        .set({
          deletedAt: now,
          updatedAt: now,
          version: sql`${categories.version} + 1`,
          syncedVersion: sql`${categories.version} + 1`,
        })
        .where(eq(categories.id, id))
        .run();
      return;
    case 'group': {
      tx.update(groups)
        .set({
          deletedAt: now,
          updatedAt: now,
          version: sql`${groups.version} + 1`,
          syncedVersion: sql`${groups.version} + 1`,
        })
        .where(eq(groups.id, id))
        .run();
      // Lo suyo que ya salió en vuelo tampoco se reintenta: sus respuestas llegarán y se ignoran.
      tx.delete(syncOutbox).where(eq(syncOutbox.groupId, id)).run();
      for (const table of [groupMembers, categories, expenses, transfers] as const) {
        tx.update(table)
          .set({
            deletedAt: now,
            updatedAt: now,
            version: sql`${table.version} + 1`,
            syncedVersion: sql`${table.version} + 1`,
          })
          .where(and(eq(table.groupId, id), isNull(table.deletedAt)))
          .run();
      }
      return;
    }
  }
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
