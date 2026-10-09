import * as fc from 'fast-check';

import { convert, convertParts, parseRate } from '../convert';
import { money } from '../money';
import { splitAmount } from '../split';

const code = (expected: string) => expect.objectContaining({ code: expected });

describe('parseRate', () => {
  it('lee tasas decimales positivas como fracción exacta', () => {
    expect(parseRate('0.9214')).toEqual({ numerator: 9214n, denominator: 10000n });
    expect(parseRate('1')).toEqual({ numerator: 1n, denominator: 1n });
    expect(parseRate('4150.5')).toEqual({ numerator: 41505n, denominator: 10n });
  });

  it.each(['0', '0.000', '-1', 'abc', '', '1e3', '1,5', '.5', '1.', ' 1', '9'.repeat(40)])(
    'rechaza la tasa %p',
    (rate) => {
      expect(() => parseRate(rate)).toThrow(code('INVALID_RATE'));
    },
  );
});

describe('convert', () => {
  it('convierte con la tasa dada: 10,00 USD a 0.9214 son 9,21 EUR', () => {
    expect(convert(money(1000, 'USD'), 'EUR', '0.9214')).toEqual(money(921, 'EUR'));
  });

  it('ajusta la escala entre monedas con distintos decimales', () => {
    expect(convert(money(1000, 'JPY'), 'USD', '0.0067')).toEqual(money(670, 'USD'));
    expect(convert(money(1000, 'KWD'), 'USD', '3.25')).toEqual(money(325, 'USD'));
    expect(convert(money(1234, 'USD'), 'JPY', '150')).toEqual(money(1851, 'JPY'));
  });

  it('redondea los empates al par más cercano', () => {
    expect(convert(money(5, 'USD'), 'EUR', '0.5')).toEqual(money(2, 'EUR'));
    expect(convert(money(3, 'USD'), 'EUR', '0.5')).toEqual(money(2, 'EUR'));
    expect(convert(money(7, 'USD'), 'EUR', '0.5')).toEqual(money(4, 'EUR'));
    expect(convert(money(-5, 'USD'), 'EUR', '0.5')).toEqual(money(-2, 'EUR'));
    expect(convert(money(-7, 'USD'), 'EUR', '0.5')).toEqual(money(-4, 'EUR'));
  });

  it('redondea fuera de los empates hacia el entero más cercano', () => {
    expect(convert(money(1000, 'USD'), 'EUR', '0.9216')).toEqual(money(922, 'EUR'));
    expect(convert(money(-1000, 'USD'), 'EUR', '0.9216')).toEqual(money(-922, 'EUR'));
  });

  it('con la misma moneda y tasa 1 deja el monto igual', () => {
    expect(convert(money(1234, 'USD'), 'USD', '1')).toEqual(money(1234, 'USD'));
  });

  it('rechaza monedas desconocidas y resultados fuera de rango', () => {
    expect(() => convert(money(1, 'USD'), 'ABC', '1')).toThrow(code('UNKNOWN_CURRENCY'));
    expect(() => convert(money(Number.MAX_SAFE_INTEGER, 'USD'), 'EUR', '2')).toThrow(
      code('AMOUNT_OUT_OF_RANGE'),
    );
  });
});

describe('convertParts', () => {
  it('reparte el total convertido entre las partes originales', () => {
    const parts = splitAmount(money(1000, 'USD'), {
      method: 'equal',
      participants: ['a', 'b', 'c'],
    });
    const convertedTotal = convert(money(1000, 'USD'), 'EUR', '0.9214');
    const converted = convertParts(parts, convertedTotal);
    expect(converted).toEqual([
      { memberId: 'a', amount: 307 },
      { memberId: 'b', amount: 307 },
      { memberId: 'c', amount: 307 },
    ]);
  });

  it('mantiene en cero las partes que eran cero', () => {
    const converted = convertParts(
      [
        { memberId: 'a', amount: 0 },
        { memberId: 'b', amount: 500 },
      ],
      money(460, 'EUR'),
    );
    expect(converted).toEqual([
      { memberId: 'a', amount: 0 },
      { memberId: 'b', amount: 460 },
    ]);
  });

  it('las partes convertidas suman exactamente el total convertido', () => {
    const rate = fc
      .tuple(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 9999 }))
      .filter(([whole, fraction]) => whole > 0 || fraction > 0)
      .map(([whole, fraction]) => `${whole}.${String(fraction).padStart(4, '0')}`);
    fc.assert(
      fc.property(
        // Hasta 10 millones de USD: con tasas de hasta 100 000 el resultado sigue en rango seguro.
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 10 }),
        rate,
        fc.constantFrom('EUR', 'JPY', 'KWD', 'COP'),
        (total, ids, rateText, target) => {
          const original = money(total, 'USD');
          const parts = splitAmount(original, { method: 'equal', participants: ids });
          const convertedTotal = convert(original, target, rateText);
          const converted = convertParts(parts, convertedTotal);
          const sumConverted = converted.reduce((s, p) => s + p.amount, 0);
          expect(sumConverted).toBe(convertedTotal.amount);
        },
      ),
    );
  });
});
