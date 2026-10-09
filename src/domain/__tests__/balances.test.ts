import * as fc from 'fast-check';

import { computeBalances, type LedgerEntry } from '../balances';
import { money } from '../money';
import { splitAmount } from '../split';

const code = (expected: string) => expect.objectContaining({ code: expected });
const asMap = (balances: ReturnType<typeof computeBalances>) =>
  Object.fromEntries(balances.map((b) => [b.memberId, b.amount.amount]));

const dinner: LedgerEntry = {
  kind: 'expense',
  payers: [{ memberId: 'a', amount: 3000 }],
  shares: [
    { memberId: 'a', amount: 1000 },
    { memberId: 'b', amount: 1000 },
    { memberId: 'c', amount: 1000 },
  ],
};

describe('computeBalances', () => {
  it('un gasto: el pagador queda a favor y los demás deben su parte', () => {
    expect(asMap(computeBalances('USD', [dinner]))).toEqual({ a: 2000, b: -1000, c: -1000 });
  });

  it('un gasto con varios pagadores', () => {
    const entry: LedgerEntry = {
      kind: 'expense',
      payers: [
        { memberId: 'a', amount: 600 },
        { memberId: 'b', amount: 400 },
      ],
      shares: [
        { memberId: 'a', amount: 500 },
        { memberId: 'c', amount: 500 },
      ],
    };
    expect(asMap(computeBalances('USD', [entry]))).toEqual({ a: 100, b: 400, c: -500 });
  });

  it('un ingreso: quien lo recibe guarda dinero de los demás', () => {
    const refund: LedgerEntry = {
      kind: 'income',
      receivers: [{ memberId: 'a', amount: 3000 }],
      shares: [
        { memberId: 'a', amount: 1000 },
        { memberId: 'b', amount: 1000 },
        { memberId: 'c', amount: 1000 },
      ],
    };
    expect(asMap(computeBalances('USD', [refund]))).toEqual({ a: -2000, b: 1000, c: 1000 });
  });

  it('una transferencia salda la deuda', () => {
    const payback: LedgerEntry = { kind: 'transfer', from: 'b', to: 'a', amount: 1000 };
    expect(asMap(computeBalances('USD', [dinner, payback]))).toEqual({ a: 1000, b: 0, c: -1000 });
  });

  it('incluye en cero a los miembros sin movimientos y ordena por memberId', () => {
    const balances = computeBalances('USD', [dinner], ['d', 'c', 'b', 'a']);
    expect(balances.map((b) => b.memberId)).toEqual(['a', 'b', 'c', 'd']);
    expect(balances[3]?.amount).toEqual(money(0, 'USD'));
    expect(balances[0]?.amount).toEqual(money(2000, 'USD'));
  });

  it('sin movimientos devuelve saldos en cero', () => {
    expect(computeBalances('JPY', [], ['a'])).toEqual([{ memberId: 'a', amount: money(0, 'JPY') }]);
  });

  it('rechaza gastos cuyo pago no coincide con lo consumido', () => {
    const broken: LedgerEntry = {
      kind: 'expense',
      payers: [{ memberId: 'a', amount: 1000 }],
      shares: [{ memberId: 'b', amount: 999 }],
    };
    expect(() => computeBalances('USD', [broken])).toThrow(code('UNBALANCED'));
  });

  it('rechaza transferencias a uno mismo o sin monto positivo', () => {
    expect(() =>
      computeBalances('USD', [{ kind: 'transfer', from: 'a', to: 'a', amount: 10 }]),
    ).toThrow(code('INVALID_TRANSFER'));
    expect(() =>
      computeBalances('USD', [{ kind: 'transfer', from: 'a', to: 'b', amount: 0 }]),
    ).toThrow(code('INVALID_TRANSFER'));
  });

  it('los saldos siempre suman cero', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const member = fc.constantFrom(...ids);
    const entry: fc.Arbitrary<LedgerEntry> = fc.oneof(
      fc
        .record({
          total: fc.integer({ min: 1, max: 10 ** 12 }),
          payers: fc.uniqueArray(member, { minLength: 1, maxLength: 5 }),
          sharers: fc.uniqueArray(member, { minLength: 1, maxLength: 5 }),
          income: fc.boolean(),
        })
        .map(({ total, payers, sharers, income }): LedgerEntry => {
          const paid = splitAmount(money(total, 'USD'), { method: 'equal', participants: payers });
          const owed = splitAmount(money(total, 'USD'), { method: 'equal', participants: sharers });
          const nonZeroPaid = paid.filter((p) => p.amount > 0);
          return income
            ? { kind: 'income', receivers: nonZeroPaid, shares: owed }
            : { kind: 'expense', payers: nonZeroPaid, shares: owed };
        }),
      fc
        .tuple(member, member, fc.integer({ min: 1, max: 10 ** 12 }))
        .filter(([from, to]) => from !== to)
        .map(([from, to, amount]): LedgerEntry => ({ kind: 'transfer', from, to, amount })),
    );
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 30 }), (entries) => {
        const balances = computeBalances('USD', entries, ids);
        const sum = balances.reduce((s, b) => s + BigInt(b.amount.amount), 0n);
        expect(sum).toBe(0n);
      }),
    );
  });
});
