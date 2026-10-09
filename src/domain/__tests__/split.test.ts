import * as fc from 'fast-check';

import { allocate } from '../allocate';
import { money } from '../money';
import { splitAmount, validatePayers, type MemberAmount, type SplitInput } from '../split';

const code = (expected: string) => expect.objectContaining({ code: expected });
const amounts = (parts: readonly MemberAmount[]) => parts.map((p) => p.amount);
const total = (parts: readonly MemberAmount[]) => parts.reduce((s, p) => s + p.amount, 0);
const usd = (amount: number) => money(amount, 'USD');

const memberIds = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 12 });
const positiveTotal = fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER });

describe('allocate', () => {
  it('reparte el residuo por mayor fracción y conserva el total', () => {
    const parts = allocate(1001, [
      { memberId: 'a', weight: 1n },
      { memberId: 'b', weight: 2n },
    ]);
    expect(parts).toEqual([
      { memberId: 'a', amount: 334 },
      { memberId: 'b', amount: 667 },
    ]);
  });

  it('desempata por memberId sin depender del orden de entrada', () => {
    const parts = allocate(1000, [
      { memberId: 'c', weight: 1n },
      { memberId: 'a', weight: 1n },
      { memberId: 'b', weight: 1n },
    ]);
    expect(parts).toEqual([
      { memberId: 'c', amount: 333 },
      { memberId: 'a', amount: 334 },
      { memberId: 'b', amount: 333 },
    ]);
  });

  it('reparte totales negativos de forma simétrica', () => {
    const parts = allocate(-1000, [
      { memberId: 'a', weight: 1n },
      { memberId: 'b', weight: 1n },
      { memberId: 'c', weight: 1n },
    ]);
    expect(amounts(parts)).toEqual([-334, -333, -333]);
  });

  it('admite pesos en cero mientras alguno sea positivo', () => {
    const parts = allocate(10, [
      { memberId: 'a', weight: 0n },
      { memberId: 'b', weight: 3n },
    ]);
    expect(amounts(parts)).toEqual([0, 10]);
  });

  it('rechaza pesos vacíos, negativos, sin total positivo o repetidos', () => {
    expect(() => allocate(10, [])).toThrow(code('INVALID_SPLIT'));
    expect(() => allocate(10, [{ memberId: 'a', weight: -1n }])).toThrow(code('INVALID_SPLIT'));
    expect(() => allocate(10, [{ memberId: 'a', weight: 0n }])).toThrow(code('INVALID_SPLIT'));
    expect(() =>
      allocate(10, [
        { memberId: 'a', weight: 1n },
        { memberId: 'a', weight: 1n },
      ]),
    ).toThrow(code('INVALID_SPLIT'));
    expect(() => allocate(1.5, [{ memberId: 'a', weight: 1n }])).toThrow(code('INVALID_AMOUNT'));
  });

  it('cada parte queda a menos de una unidad de su cuota exacta', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -(2 ** 53 - 1), max: 2 ** 53 - 1 }),
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 10 }),
        fc.array(fc.bigInt({ min: 1n, max: 10n ** 12n }), { minLength: 10, maxLength: 10 }),
        (value, ids, rawWeights) => {
          const weights = ids.map((memberId, i) => ({ memberId, weight: rawWeights[i] ?? 1n }));
          const parts = allocate(value, weights);
          const weightSum = weights.reduce((s, w) => s + w.weight, 0n);
          expect(total(parts)).toBe(value);
          parts.forEach((part, i) => {
            const exactTimesSum = BigInt(value) * (weights[i]?.weight ?? 0n);
            const diff = BigInt(part.amount) * weightSum - exactTimesSum;
            expect(diff < weightSum && diff > -weightSum).toBe(true);
          });
        },
      ),
    );
  });
});

describe('splitAmount', () => {
  it('divide por igual: 10,00 USD entre 3', () => {
    const parts = splitAmount(usd(1000), { method: 'equal', participants: ['a', 'b', 'c'] });
    expect(amounts(parts)).toEqual([334, 333, 333]);
  });

  it('divide un centavo entre 3', () => {
    const parts = splitAmount(usd(1), { method: 'equal', participants: ['a', 'b', 'c'] });
    expect(amounts(parts)).toEqual([1, 0, 0]);
  });

  it('respeta monedas sin decimales: 1000 JPY entre 3', () => {
    const parts = splitAmount(money(1000, 'JPY'), {
      method: 'equal',
      participants: ['a', 'b', 'c'],
    });
    expect(amounts(parts)).toEqual([334, 333, 333]);
  });

  it('divide por partes: 10,01 USD en 1 y 2', () => {
    const parts = splitAmount(usd(1001), {
      method: 'shares',
      shares: [
        { memberId: 'a', shares: 1 },
        { memberId: 'b', shares: 2 },
      ],
    });
    expect(amounts(parts)).toEqual([334, 667]);
  });

  it('divide por porcentajes en puntos básicos', () => {
    const parts = splitAmount(usd(1000), {
      method: 'percentage',
      percentages: [
        { memberId: 'a', basisPoints: 3333 },
        { memberId: 'b', basisPoints: 3333 },
        { memberId: 'c', basisPoints: 3334 },
      ],
    });
    expect(amounts(parts)).toEqual([333, 333, 334]);
  });

  it('acepta montos exactos que suman el total', () => {
    const parts = splitAmount(usd(1000), {
      method: 'exact',
      amounts: [
        { memberId: 'a', amount: 700 },
        { memberId: 'b', amount: 300 },
      ],
    });
    expect(parts).toEqual([
      { memberId: 'a', amount: 700 },
      { memberId: 'b', amount: 300 },
    ]);
  });

  it('asigna todo a un único participante', () => {
    const parts = splitAmount(usd(999), { method: 'equal', participants: ['solo'] });
    expect(parts).toEqual([{ memberId: 'solo', amount: 999 }]);
  });

  it('soporta montos enormes sin perder precisión', () => {
    const big = Number.MAX_SAFE_INTEGER;
    const parts = splitAmount(usd(big), { method: 'equal', participants: ['a', 'b', 'c'] });
    expect(total(parts)).toBe(big);
  });

  it.each<[string, SplitInput]>([
    ['sin participantes', { method: 'equal', participants: [] }],
    ['participantes repetidos', { method: 'equal', participants: ['a', 'a'] }],
    [
      'porcentajes que no suman 10 000',
      {
        method: 'percentage',
        percentages: [
          { memberId: 'a', basisPoints: 5000 },
          { memberId: 'b', basisPoints: 4999 },
        ],
      },
    ],
    [
      'porcentajes no enteros',
      { method: 'percentage', percentages: [{ memberId: 'a', basisPoints: 10000.5 }] },
    ],
    [
      'porcentajes negativos',
      {
        method: 'percentage',
        percentages: [
          { memberId: 'a', basisPoints: 10001 },
          { memberId: 'b', basisPoints: -1 },
        ],
      },
    ],
    ['partes en cero', { method: 'shares', shares: [{ memberId: 'a', shares: 0 }] }],
    ['partes no enteras', { method: 'shares', shares: [{ memberId: 'a', shares: 1.5 }] }],
    [
      'montos exactos que no suman el total',
      {
        method: 'exact',
        amounts: [
          { memberId: 'a', amount: 600 },
          { memberId: 'b', amount: 300 },
        ],
      },
    ],
    [
      'montos exactos negativos',
      {
        method: 'exact',
        amounts: [
          { memberId: 'a', amount: 1100 },
          { memberId: 'b', amount: -100 },
        ],
      },
    ],
  ])('rechaza %s', (_name, input) => {
    expect(() => splitAmount(usd(1000), input)).toThrow(code('INVALID_SPLIT'));
  });

  it('rechaza totales que no son positivos', () => {
    expect(() => splitAmount(usd(0), { method: 'equal', participants: ['a'] })).toThrow(
      code('INVALID_AMOUNT'),
    );
    expect(() => splitAmount(usd(-5), { method: 'equal', participants: ['a'] })).toThrow(
      code('INVALID_AMOUNT'),
    );
  });

  it('las partes siempre suman el total, con cualquier método', () => {
    fc.assert(
      fc.property(positiveTotal, memberIds, fc.integer({ min: 1, max: 1000 }), (value, ids, k) => {
        const inputs: SplitInput[] = [
          { method: 'equal', participants: ids },
          {
            method: 'shares',
            shares: ids.map((memberId, i) => ({ memberId, shares: (i % k) + 1 })),
          },
          { method: 'percentage', percentages: percentagesFor(ids) },
        ];
        for (const input of inputs) {
          expect(total(splitAmount(usd(value), input))).toBe(value);
        }
      }),
    );
  });

  it('el resultado de cada miembro no depende del orden de entrada', () => {
    fc.assert(
      fc.property(positiveTotal, memberIds, (value, ids) => {
        const byMember = (parts: readonly MemberAmount[]) =>
          Object.fromEntries(parts.map((p) => [p.memberId, p.amount]));
        const forward = splitAmount(usd(value), { method: 'equal', participants: ids });
        const reversed = splitAmount(usd(value), {
          method: 'equal',
          participants: [...ids].reverse(),
        });
        expect(byMember(reversed)).toEqual(byMember(forward));
      }),
    );
  });
});

describe('validatePayers', () => {
  it('acepta uno o varios pagadores que suman el total', () => {
    expect(validatePayers(usd(1000), [{ memberId: 'a', amount: 1000 }])).toEqual([
      { memberId: 'a', amount: 1000 },
    ]);
    expect(
      validatePayers(usd(1000), [
        { memberId: 'a', amount: 600 },
        { memberId: 'b', amount: 400 },
      ]),
    ).toHaveLength(2);
  });

  it.each<[string, MemberAmount[]]>([
    ['sin pagadores', []],
    ['montos que no suman el total', [{ memberId: 'a', amount: 900 }]],
    [
      'pagadores repetidos',
      [
        { memberId: 'a', amount: 500 },
        { memberId: 'a', amount: 500 },
      ],
    ],
    [
      'montos en cero o negativos',
      [
        { memberId: 'a', amount: 1000 },
        { memberId: 'b', amount: 0 },
      ],
    ],
    [
      'montos no enteros',
      [
        { memberId: 'a', amount: 999.5 },
        { memberId: 'b', amount: 0.5 },
      ],
    ],
  ])('rechaza %s', (_name, payers) => {
    expect(() => validatePayers(usd(1000), payers)).toThrow(code('INVALID_PAYERS'));
  });
});

/** Porcentajes en puntos básicos que suman exactamente 10 000. */
function percentagesFor(ids: readonly string[]) {
  const base = Math.floor(10000 / ids.length);
  return ids.map((memberId, i) => ({
    memberId,
    basisPoints: i === 0 ? 10000 - base * (ids.length - 1) : base,
  }));
}
