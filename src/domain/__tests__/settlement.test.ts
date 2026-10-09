import * as fc from 'fast-check';

import type { Balance } from '../balances';
import { money } from '../money';
import { EXACT_SETTLEMENT_LIMIT, settle, type Transfer } from '../settlement';

const code = (expected: string) => expect.objectContaining({ code: expected });
const balances = (values: Record<string, number>, currency = 'USD'): Balance[] =>
  Object.entries(values).map(([memberId, amount]) => ({
    memberId,
    amount: money(amount, currency),
  }));
const plain = (transfers: readonly Transfer[]) =>
  transfers.map((t) => [t.from, t.to, t.amount.amount] as const);

/** Aplica las transferencias y devuelve los saldos resultantes. */
function apply(start: readonly Balance[], transfers: readonly Transfer[]): Map<string, number> {
  const result = new Map(start.map((b) => [b.memberId, b.amount.amount]));
  for (const t of transfers) {
    result.set(t.from, (result.get(t.from) ?? 0) + t.amount.amount);
    result.set(t.to, (result.get(t.to) ?? 0) - t.amount.amount);
  }
  return result;
}

/** Máximo de subgrupos disjuntos que suman cero, por fuerza bruta. */
function bruteForceMaxGroups(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const [first, ...rest] = values;
  let best = 0;
  const total = 1 << rest.length;
  for (let mask = 0; mask < total; mask++) {
    let sum = first ?? 0;
    const remaining: number[] = [];
    rest.forEach((v, i) => (mask & (1 << i) ? (sum += v) : remaining.push(v)));
    if (sum === 0) {
      best = Math.max(best, 1 + bruteForceMaxGroups(remaining));
    }
  }
  return best;
}

/** Saldos aleatorios que suman cero, con ids únicos. */
const zeroSumBalances = (minMembers: number, maxMembers: number, maxAmount = 10_000) =>
  fc.uniqueArray(fc.uuid(), { minLength: minMembers, maxLength: maxMembers }).chain((ids) =>
    fc
      .array(fc.integer({ min: -maxAmount, max: maxAmount }), {
        minLength: ids.length - 1,
        maxLength: ids.length - 1,
      })
      .map((values) => {
        const last = -values.reduce((s, v) => s + v, 0);
        return ids.map((memberId, i) => ({
          memberId,
          amount: money(i < values.length ? (values[i] ?? 0) : last, 'USD'),
        }));
      }),
  );

describe('settle', () => {
  it('no propone transferencias si nadie debe nada', () => {
    expect(settle([])).toEqual([]);
    expect(settle(balances({ a: 0 }))).toEqual([]);
    expect(settle(balances({ a: 0, b: 0, c: 0 }))).toEqual([]);
  });

  it('salda una deuda simple', () => {
    expect(plain(settle(balances({ a: 1000, b: -1000 })))).toEqual([['b', 'a', 1000]]);
  });

  it('salda a varios deudores ordenando por pagador y receptor', () => {
    expect(plain(settle(balances({ a: 2000, b: -1000, c: -1000 })))).toEqual([
      ['b', 'a', 1000],
      ['c', 'a', 1000],
    ]);
  });

  it('encuentra el mínimo donde el voraz usa una transferencia de más', () => {
    const start = balances({ a: 400, b: 600, c: -300, d: -300, e: -400 });
    expect(plain(settle(start))).toEqual([
      ['c', 'b', 300],
      ['d', 'b', 300],
      ['e', 'a', 400],
    ]);
    expect(settle(start, { exactLimit: 0 })).toHaveLength(4);
  });

  it('rechaza saldos que no suman cero, monedas mezcladas y miembros repetidos', () => {
    expect(() => settle(balances({ a: 10, b: -9 }))).toThrow(code('UNBALANCED'));
    expect(() =>
      settle([
        { memberId: 'a', amount: money(10, 'USD') },
        { memberId: 'b', amount: money(-10, 'EUR') },
      ]),
    ).toThrow(code('CURRENCY_MISMATCH'));
    expect(() =>
      settle([
        { memberId: 'a', amount: money(10, 'USD') },
        { memberId: 'a', amount: money(-10, 'USD') },
      ]),
    ).toThrow(code('DUPLICATE_MEMBER'));
  });

  it('con saldos enormes sigue saldando todo', () => {
    const big = Number.MAX_SAFE_INTEGER;
    const start = balances({ a: big, b: -big, c: big - 1, d: 1 - big });
    const transfers = settle(start);
    expect([...apply(start, transfers).values()].every((v) => v === 0)).toBe(true);
    expect(transfers).toHaveLength(2);
  });

  it('resuelve el límite exacto de miembros', () => {
    expect(EXACT_SETTLEMENT_LIMIT).toBeGreaterThanOrEqual(12);
    const ids = Array.from(
      { length: EXACT_SETTLEMENT_LIMIT },
      (_, i) => `m${String(i).padStart(2, '0')}`,
    );
    const start = ids.map((memberId, i) => ({
      memberId,
      amount: money(i < ids.length / 2 ? 100 + i : -(100 + i - ids.length / 2), 'USD'),
    }));
    const transfers = settle(start);
    expect([...apply(start, transfers).values()].every((v) => v === 0)).toBe(true);
    expect(transfers.length).toBeLessThanOrEqual(ids.length / 2);
  });

  it('siempre deja todos los saldos en cero, con montos positivos de deudor a acreedor', () => {
    fc.assert(
      fc.property(zeroSumBalances(1, 12), (start) => {
        const transfers = settle(start);
        expect([...apply(start, transfers).values()].every((v) => v === 0)).toBe(true);
        const initial = new Map(start.map((b) => [b.memberId, b.amount.amount]));
        for (const t of transfers) {
          expect(t.amount.amount).toBeGreaterThan(0);
          expect(initial.get(t.from)).toBeLessThan(0);
          expect(initial.get(t.to)).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('usa el mínimo de transferencias, igual que la fuerza bruta', () => {
    fc.assert(
      fc.property(zeroSumBalances(2, 7, 50), (start) => {
        const nonZero = start.map((b) => b.amount.amount).filter((v) => v !== 0);
        const minimum = nonZero.length - bruteForceMaxGroups(nonZero);
        expect(settle(start)).toHaveLength(minimum);
      }),
    );
  });

  it('es determinista: el orden de entrada no cambia el resultado', () => {
    fc.assert(
      fc.property(
        zeroSumBalances(1, 12).chain((start) =>
          fc.tuple(fc.constant(start), fc.shuffledSubarray(start, { minLength: start.length })),
        ),
        ([start, shuffled]) => {
          expect(settle(shuffled)).toEqual(settle(start));
        },
      ),
    );
  });

  it('por encima del límite exacto usa como máximo n − 1 transferencias', () => {
    fc.assert(
      fc.property(zeroSumBalances(2, 15), (start) => {
        const nonZero = start.filter((b) => b.amount.amount !== 0).length;
        const transfers = settle(start, { exactLimit: 3 });
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
        expect([...apply(start, transfers).values()].every((v) => v === 0)).toBe(true);
      }),
    );
  });
});
