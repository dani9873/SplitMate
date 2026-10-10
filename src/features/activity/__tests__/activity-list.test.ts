import type { ActivityItem } from '@/db/repositories';
import { money } from '@/domain';

import { filterActivity, groupByDay, hasFilters, NO_FILTERS } from '../activity-list';

const party = (memberId: string, name: string) => ({ memberId, name, removed: false });
const share = (memberId: string, name: string, amount: number) => ({
  ...party(memberId, name),
  amount: money(amount, 'USD'),
});

const base = {
  version: 1,
  groupId: 'g1',
  groupName: 'Viaje a Cartagena',
  groupCurrency: 'USD',
  exchangeRate: '1',
};

const dinner: ActivityItem = {
  ...base,
  kind: 'expense',
  id: 'e2',
  occurredOn: '2026-10-09',
  title: 'Cena en Getsemaní',
  categoryId: 'food',
  splitMethod: 'equal',
  amount: money(9000, 'USD'),
  groupAmount: money(9000, 'USD'),
  payers: [share('ana', 'Ana', 9000)],
  splits: [share('ana', 'Ana', 4500), share('beto', 'Beto', 4500), share('carla', 'Carla', 0)],
};

const taxi: ActivityItem = {
  ...base,
  kind: 'expense',
  id: 'e1',
  occurredOn: '2026-10-08',
  title: 'Taxi',
  categoryId: 'transport',
  splitMethod: 'equal',
  amount: money(2000, 'USD'),
  groupAmount: money(2000, 'USD'),
  payers: [share('carla', 'Carla', 2000)],
  splits: [share('carla', 'Carla', 2000)],
};

const payment: ActivityItem = {
  ...base,
  kind: 'transfer',
  id: 't1',
  occurredOn: '2026-10-09',
  amount: money(500, 'USD'),
  groupAmount: money(500, 'USD'),
  from: party('beto', 'Beto'),
  to: party('ana', 'Ana'),
};

const items = [payment, dinner, taxi];
const labels: Record<string, string> = { food: 'Comida', transport: 'Transporte' };
const label = (id: string) => labels[id] ?? '';
const ids = (list: readonly ActivityItem[]) => list.map((item) => item.id);

describe('filtros de actividad', () => {
  it('sin filtros devuelve todo', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(ids(filterActivity(items, NO_FILTERS, label))).toEqual(['t1', 'e2', 'e1']);
  });

  it('busca sin distinguir mayúsculas ni tildes, en descripción, personas y categoría', () => {
    const search = (query: string) => ids(filterActivity(items, { ...NO_FILTERS, query }, label));
    expect(search('getsemani')).toEqual(['e2']);
    expect(search('  CENA  ')).toEqual(['e2']);
    expect(search('beto')).toEqual(['t1', 'e2']);
    expect(search('transporte')).toEqual(['e1']);
    expect(search('cartagena')).toEqual(['t1', 'e2', 'e1']);
    expect(search('cena carla')).toEqual(['e2']);
    expect(search('hotel')).toEqual([]);
  });

  it('filtra por categoría, sin transferencias', () => {
    expect(ids(filterActivity(items, { ...NO_FILTERS, categoryId: 'food' }, label))).toEqual([
      'e2',
    ]);
  });

  it('filtra por miembro según participe con algo', () => {
    const byMember = (memberId: string) =>
      ids(filterActivity(items, { ...NO_FILTERS, memberId }, label));
    expect(byMember('beto')).toEqual(['t1', 'e2']);
    expect(byMember('carla')).toEqual(['e1']);
    expect(hasFilters({ ...NO_FILTERS, memberId: 'carla' })).toBe(true);
  });

  it('agrupa por día con encabezados fijos', () => {
    const { rows, stickyHeaderIndices } = groupByDay(items);
    expect(rows.map((row) => (row.type === 'day' ? row.date : row.item.id))).toEqual([
      '2026-10-09',
      't1',
      'e2',
      '2026-10-08',
      'e1',
    ]);
    expect(stickyHeaderIndices).toEqual([0, 3]);
    expect(groupByDay([])).toEqual({ rows: [], stickyHeaderIndices: [] });
  });
});
