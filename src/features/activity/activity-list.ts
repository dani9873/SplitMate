import type { ActivityItem } from '@/db/repositories';
import type { CalendarDate } from '@/lib/calendar-date';

import { normalizeForSearch } from '../currency';

export interface ActivityFilters {
  readonly query: string;
  readonly categoryId: string | null;
  readonly memberId: string | null;
}

export const NO_FILTERS: ActivityFilters = { query: '', categoryId: null, memberId: null };

export function hasFilters(filters: ActivityFilters): boolean {
  return filters.query.trim() !== '' || filters.categoryId !== null || filters.memberId !== null;
}

/** Miembros que participan en el movimiento: pagan, reciben, consumen o transfieren. */
export function involvedMemberIds(item: ActivityItem): string[] {
  if (item.kind === 'transfer') {
    return [item.from.memberId, item.to.memberId];
  }
  return [
    ...item.payers.map((p) => p.memberId),
    ...item.splits.filter((s) => s.amount.amount > 0).map((s) => s.memberId),
  ];
}

/** Textos donde busca la búsqueda: descripción, personas, categoría y grupo. */
function searchableText(item: ActivityItem, categoryLabel: (id: string) => string): string {
  const names =
    item.kind === 'transfer'
      ? [item.from.name, item.to.name]
      : [...item.payers.map((p) => p.name), ...item.splits.map((s) => s.name)];
  const parts = [
    item.kind === 'transfer' ? '' : item.title,
    item.kind === 'transfer' || !item.categoryId ? '' : categoryLabel(item.categoryId),
    item.groupName,
    ...names,
  ];
  return normalizeForSearch(parts.join(' '));
}

/**
 * Filtra el historial por texto (sin distinguir mayúsculas ni tildes), por categoría y por
 * miembro. Con una categoría elegida, las transferencias quedan fuera porque no la tienen.
 */
export function filterActivity(
  items: readonly ActivityItem[],
  filters: ActivityFilters,
  categoryLabel: (id: string) => string,
): ActivityItem[] {
  const words = normalizeForSearch(filters.query).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (filters.categoryId !== null) {
      if (item.kind === 'transfer' || item.categoryId !== filters.categoryId) {
        return false;
      }
    }
    if (filters.memberId !== null && !involvedMemberIds(item).includes(filters.memberId)) {
      return false;
    }
    if (words.length === 0) {
      return true;
    }
    const text = searchableText(item, categoryLabel);
    return words.every((word) => text.includes(word));
  });
}

export type ActivityRow =
  | { readonly type: 'day'; readonly key: string; readonly date: CalendarDate }
  | { readonly type: 'item'; readonly key: string; readonly item: ActivityItem };

/**
 * Filas para la lista: un encabezado por día seguido de sus movimientos, ya ordenados del
 * más reciente al más antiguo. Devuelve también los índices de los encabezados fijos.
 */
export function groupByDay(items: readonly ActivityItem[]): {
  rows: ActivityRow[];
  stickyHeaderIndices: number[];
} {
  const rows: ActivityRow[] = [];
  const stickyHeaderIndices: number[] = [];
  let current: CalendarDate | null = null;
  for (const item of items) {
    if (item.occurredOn !== current) {
      current = item.occurredOn;
      stickyHeaderIndices.push(rows.length);
      rows.push({ type: 'day', key: `day-${current}`, date: current });
    }
    rows.push({ type: 'item', key: item.id, item });
  }
  return { rows, stickyHeaderIndices };
}
