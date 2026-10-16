import { and, asc, eq, isNull, sql } from 'drizzle-orm';

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
  syncCursors,
  transfers,
} from '../schema';
import {
  insertUnitFromServer,
  parseRemoteRowsLenient,
  replaceUnitFromServer,
  tablesOf,
  type ParsedRows,
} from './apply';
import type { ApplyOutcome } from './types';
import type { RemoteGroupChanges, SyncEntity } from './wire';

/**
 * Aplica a la base local la descarga de un grupo. Quien llama la envuelve en una transacción que
 * también guarda el cursor (`applyRemoteGroup` del `SyncStore`): o entra todo o no avanza nada.
 *
 * Cada unidad (grupo, miembro, categoría, gasto con sus pagadores y partes, transferencia) va en su
 * propio punto de guardado. Las FK se revisan en el momento de escribir (la base las tiene
 * activas): una fila cuyo padre falta falla ahí, deshace solo su unidad y deja el grupo retenido.
 * El orden por tabla (padres antes que hijos) hace que los padres del mismo lote ya estén.
 */

export interface GroupApplyResult extends ApplyOutcome {
  /** Tablas locales que cambiaron, para avisar en el bus. */
  readonly tables: readonly TableName[];
}

interface Versions {
  readonly version: number;
  readonly syncedVersion: number;
  readonly serverVersion: number | null;
}

type UnitResult = 'applied' | 'skipped' | 'unchanged';

function readVersions(tx: AppDatabase, entity: SyncEntity, id: string): Versions | undefined {
  switch (entity) {
    case 'group':
      return tx.select().from(groups).where(eq(groups.id, id)).get();
    case 'member':
      return tx.select().from(groupMembers).where(eq(groupMembers.id, id)).get();
    case 'category':
      return tx.select().from(categories).where(eq(categories.id, id)).get();
    case 'expense':
      return tx.select().from(expenses).where(eq(expenses.id, id)).get();
    case 'transfer':
      return tx.select().from(transfers).where(eq(transfers.id, id)).get();
  }
}

/** El gasto sin ceros a la derecha en la tasa y sin distinguir notas vacías de nulas. */
const rate = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
const gone = (instant: number | null): boolean => instant !== null;

interface Parts {
  readonly id: string;
  readonly memberId: string;
  readonly amount: number;
  readonly groupAmount: number;
  readonly inputValue?: number | null;
}

const byId = (a: Parts, b: Parts) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * ¿El servidor dice lo mismo que ya tengo? Se compara el contenido, no las fechas: el borrado y
 * el archivado cuentan como sí o no, no como instante.
 */
function sameContent(tx: AppDatabase, entity: SyncEntity, id: string, rows: ParsedRows): boolean {
  switch (entity) {
    case 'group': {
      const r = rows.groups.find((row) => row.id === id);
      const l = tx.select().from(groups).where(eq(groups.id, id)).get();
      return (
        !!r &&
        !!l &&
        l.name === r.name &&
        l.currency === r.currency &&
        l.emoji === r.emoji &&
        l.color === r.color &&
        gone(l.archivedAt) === gone(r.archived_at) &&
        gone(l.deletedAt) === gone(r.deleted_at)
      );
    }
    case 'member': {
      const r = rows.members.find((row) => row.id === id);
      const l = tx.select().from(groupMembers).where(eq(groupMembers.id, id)).get();
      return (
        !!r &&
        !!l &&
        l.displayName === r.display_name &&
        l.userId === r.user_id &&
        l.role === r.role &&
        gone(l.deletedAt) === gone(r.deleted_at)
      );
    }
    case 'category': {
      const r = rows.categories.find((row) => row.id === id);
      const l = tx.select().from(categories).where(eq(categories.id, id)).get();
      return (
        !!r &&
        !!l &&
        l.name === r.name &&
        l.icon === r.icon &&
        gone(l.deletedAt) === gone(r.deleted_at)
      );
    }
    case 'expense': {
      const r = rows.expenses.find((row) => row.id === id);
      const l = tx.select().from(expenses).where(eq(expenses.id, id)).get();
      if (!r || !l) {
        return false;
      }
      const fields =
        l.groupCurrency === r.group_currency &&
        l.kind === r.kind &&
        l.title === r.title &&
        l.amount === r.amount &&
        l.currency === r.currency &&
        l.groupAmount === r.group_amount &&
        rate(l.exchangeRate) === rate(r.exchange_rate) &&
        l.rateDate === r.rate_date &&
        l.splitMethod === r.split_method &&
        l.categoryId === r.category_id &&
        l.occurredOn === r.occurred_on &&
        (l.notes ?? '') === (r.notes ?? '') &&
        gone(l.deletedAt) === gone(r.deleted_at);
      return fields && sameChildren(tx, id, rows);
    }
    case 'transfer': {
      const r = rows.transfers.find((row) => row.id === id);
      const l = tx.select().from(transfers).where(eq(transfers.id, id)).get();
      return (
        !!r &&
        !!l &&
        l.groupCurrency === r.group_currency &&
        l.fromMemberId === r.from_member_id &&
        l.toMemberId === r.to_member_id &&
        l.amount === r.amount &&
        l.currency === r.currency &&
        l.groupAmount === r.group_amount &&
        rate(l.exchangeRate) === rate(r.exchange_rate) &&
        l.rateDate === r.rate_date &&
        l.occurredOn === r.occurred_on &&
        gone(l.deletedAt) === gone(r.deleted_at)
      );
    }
  }
}

const sameParts = (a: readonly Parts[], b: readonly Parts[]): boolean =>
  a.length === b.length &&
  [...a].sort(byId).every((x, i) => {
    const y = [...b].sort(byId)[i] as Parts;
    return (
      x.id === y.id &&
      x.memberId === y.memberId &&
      x.amount === y.amount &&
      x.groupAmount === y.groupAmount &&
      (x.inputValue ?? null) === (y.inputValue ?? null)
    );
  });

/** Los pagadores y partes activos del gasto, locales y del servidor, son los mismos. */
function sameChildren(tx: AppDatabase, expenseId: string, rows: ParsedRows): boolean {
  const localPayers = tx
    .select()
    .from(expensePayers)
    .where(and(eq(expensePayers.expenseId, expenseId), isNull(expensePayers.deletedAt)))
    .all();
  const localSplits = tx
    .select()
    .from(expenseSplits)
    .where(and(eq(expenseSplits.expenseId, expenseId), isNull(expenseSplits.deletedAt)))
    .all();
  const remotePayers = rows.payers.filter(
    (p) => p.expense_id === expenseId && p.deleted_at === null,
  );
  const remoteSplits = rows.splits.filter(
    (p) => p.expense_id === expenseId && p.deleted_at === null,
  );
  const asParts = (list: readonly (typeof remotePayers)[number][]): Parts[] =>
    list.map((p) => ({
      id: p.id,
      memberId: p.member_id,
      amount: p.amount,
      groupAmount: p.group_amount,
    }));
  return (
    sameParts(localPayers, asParts(remotePayers)) &&
    sameParts(
      localSplits,
      remoteSplits.map((p) => ({
        id: p.id,
        memberId: p.member_id,
        amount: p.amount,
        groupAmount: p.group_amount,
        inputValue: p.input_value,
      })),
    )
  );
}

/** Guarda la versión del servidor de la unidad y de sus hijas, sin tocar nada más. */
function setServerVersions(tx: AppDatabase, entity: SyncEntity, id: string, rows: ParsedRows) {
  switch (entity) {
    case 'group': {
      const r = rows.groups.find((row) => row.id === id);
      if (r) {
        tx.update(groups).set({ serverVersion: r.version }).where(eq(groups.id, id)).run();
      }
      return;
    }
    case 'member': {
      const r = rows.members.find((row) => row.id === id);
      if (r) {
        tx.update(groupMembers)
          .set({ serverVersion: r.version })
          .where(eq(groupMembers.id, id))
          .run();
      }
      return;
    }
    case 'category': {
      const r = rows.categories.find((row) => row.id === id);
      if (r) {
        tx.update(categories).set({ serverVersion: r.version }).where(eq(categories.id, id)).run();
      }
      return;
    }
    case 'expense': {
      const r = rows.expenses.find((row) => row.id === id);
      if (r) {
        tx.update(expenses).set({ serverVersion: r.version }).where(eq(expenses.id, id)).run();
      }
      for (const p of rows.payers.filter((row) => row.expense_id === id)) {
        tx.update(expensePayers)
          .set({ serverVersion: p.version })
          .where(eq(expensePayers.id, p.id))
          .run();
      }
      for (const p of rows.splits.filter((row) => row.expense_id === id)) {
        tx.update(expenseSplits)
          .set({ serverVersion: p.version })
          .where(eq(expenseSplits.id, p.id))
          .run();
      }
      return;
    }
    case 'transfer': {
      const r = rows.transfers.find((row) => row.id === id);
      if (r) {
        tx.update(transfers).set({ serverVersion: r.version }).where(eq(transfers.id, id)).run();
      }
      return;
    }
  }
}

/**
 * Una unidad del servidor frente a la local:
 * - no existe aquí: se inserta;
 * - tiene cambios locales sin subir: se conserva lo local (el envío decide, con su versión base);
 * - el servidor no trae nada más nuevo que lo que ya sé (eco de lo propio o lote repetido): nada;
 * - mismo contenido con otra versión: solo se anota la versión del servidor;
 * - contenido distinto: se reemplaza y sube `version` (un formulario abierto da CONFLICT).
 */
function applyUnit(
  tx: AppDatabase,
  entity: SyncEntity,
  id: string,
  serverVersion: number,
  rows: ParsedRows,
  now: number,
): UnitResult {
  const local = readVersions(tx, entity, id);
  if (!local) {
    insertUnitFromServer(tx, entity, id, rows, now);
    return 'applied';
  }
  if (local.version !== local.syncedVersion) {
    return 'skipped';
  }
  if (local.serverVersion !== null && serverVersion <= local.serverVersion) {
    return 'unchanged';
  }
  if (sameContent(tx, entity, id, rows)) {
    setServerVersions(tx, entity, id, rows);
    return 'unchanged';
  }
  replaceUnitFromServer(tx, entity, id, rows, now);
  return 'applied';
}

interface Unit {
  readonly entity: SyncEntity;
  readonly id: string;
  readonly version: number;
}

/**
 * Las unidades del lote en el orden de aplicación: por tabla, padres antes que hijos. Entre los
 * miembros va primero lo que libera (borrados y sin cuenta), así "soy yo" puede pasar de uno a otro
 * sin chocar con el índice único.
 */
function orderedUnits(rows: ParsedRows): Unit[] {
  const frees = (m: ParsedRows['members'][number]) => m.deleted_at !== null || m.user_id === null;
  return [
    ...rows.groups.map((r) => ({ entity: 'group' as const, id: r.id, version: r.version })),
    ...[...rows.members]
      .sort((a, b) => Number(frees(b)) - Number(frees(a)))
      .map((r) => ({ entity: 'member' as const, id: r.id, version: r.version })),
    // Las categorías predefinidas no tienen grupo y no se descargan.
    ...rows.categories
      .filter((r) => r.group_id !== null)
      .map((r) => ({ entity: 'category' as const, id: r.id, version: r.version })),
    ...rows.expenses.map((r) => ({ entity: 'expense' as const, id: r.id, version: r.version })),
    ...rows.transfers.map((r) => ({ entity: 'transfer' as const, id: r.id, version: r.version })),
  ];
}

/** Filas que dicen ser de otro grupo que el que se descarga: no se aplican. */
function foreignRows(groupId: string, rows: ParsedRows): number {
  return (
    rows.groups.filter((r) => r.id !== groupId).length +
    rows.members.filter((r) => r.group_id !== groupId).length +
    rows.categories.filter((r) => r.group_id !== null && r.group_id !== groupId).length +
    rows.expenses.filter((r) => r.group_id !== groupId).length +
    rows.transfers.filter((r) => r.group_id !== groupId).length
  );
}

/** Un gasto, una transferencia... sin las filas de otros grupos. */
function onlyThisGroup(groupId: string, rows: ParsedRows): ParsedRows {
  const expenseIds = new Set(rows.expenses.filter((r) => r.group_id === groupId).map((r) => r.id));
  return {
    groups: rows.groups.filter((r) => r.id === groupId),
    members: rows.members.filter((r) => r.group_id === groupId),
    categories: rows.categories.filter((r) => r.group_id === groupId),
    expenses: rows.expenses.filter((r) => r.group_id === groupId),
    payers: rows.payers.filter((r) => expenseIds.has(r.expense_id)),
    splits: rows.splits.filter((r) => expenseIds.has(r.expense_id)),
    transfers: rows.transfers.filter((r) => r.group_id === groupId),
  };
}

export function applyGroupChanges(
  tx: AppDatabase,
  changes: RemoteGroupChanges,
  now: number,
): GroupApplyResult {
  const { rows: all, invalid } = parseRemoteRowsLenient(changes.rows);
  const rows = onlyThisGroup(changes.id, all);
  // Cada fila inválida, de otro grupo o hija de un gasto que no llegó deja el grupo retenido.
  const expenseIds = new Set(all.expenses.map((r) => r.id));
  const orphans =
    all.payers.filter((r) => !expenseIds.has(r.expense_id)).length +
    all.splits.filter((r) => !expenseIds.has(r.expense_id)).length;
  let held = invalid > 0 || foreignRows(changes.id, all) > 0 || orphans > 0;

  let applied = 0;
  let skipped = 0;
  const tables = new Set<TableName>();
  for (const unit of orderedUnits(rows)) {
    try {
      const result = tx.transaction((unitTx) =>
        applyUnit(unitTx, unit.entity, unit.id, unit.version, rows, now),
      );
      if (result === 'applied') {
        applied += 1;
        tablesOf(unit.entity).forEach((table) => tables.add(table));
      } else if (result === 'skipped') {
        skipped += 1;
      }
    } catch (error) {
      // La unidad se deshizo sola (punto de guardado). Un mensaje fijo: sin datos de la fila.
      held = true;
      logger.error('No se pudo aplicar una unidad de la descarga', error);
    }
  }
  return { applied, skipped, held, tables: [...tables] };
}

/** Hasta qué `change_seq` se descargó cada grupo. */
export function readCursors(db: AppDatabase): Record<string, number> {
  return Object.fromEntries(
    db
      .select()
      .from(syncCursors)
      .orderBy(asc(syncCursors.groupId))
      .all()
      .map((row) => [row.groupId, row.cursor]),
  );
}

/** Guarda el cursor de un grupo. Nunca retrocede: un lote repetido o viejo no lo baja. */
export function writeCursor(tx: AppDatabase, groupId: string, cursor: number, now: number): void {
  tx.insert(syncCursors)
    .values({ groupId, cursor, updatedAt: now })
    .onConflictDoUpdate({
      target: syncCursors.groupId,
      set: { cursor: sql`max(${syncCursors.cursor}, ${cursor})`, updatedAt: now },
    })
    .run();
}
