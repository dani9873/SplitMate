import * as fc from 'fast-check';

import {
  add,
  compare,
  equals,
  isZero,
  money,
  negate,
  parseMoney,
  subtract,
  sum,
  toDecimalString,
  zero,
} from '../money';

const code = (expected: string) => expect.objectContaining({ code: expected });
const safeAmount = fc.integer({ min: -(2 ** 50), max: 2 ** 50 });

describe('Money', () => {
  it('guarda enteros en unidades menores con su moneda', () => {
    expect(money(1234, 'USD')).toEqual({ amount: 1234, currency: 'USD' });
    expect(zero('JPY')).toEqual({ amount: 0, currency: 'JPY' });
  });

  it('rechaza montos que no son enteros seguros', () => {
    expect(() => money(12.5, 'USD')).toThrow(code('INVALID_AMOUNT'));
    expect(() => money(Number.NaN, 'USD')).toThrow(code('INVALID_AMOUNT'));
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(code('AMOUNT_OUT_OF_RANGE'));
  });

  it('rechaza monedas desconocidas', () => {
    expect(() => money(1, 'ABC')).toThrow(code('UNKNOWN_CURRENCY'));
  });

  it('suma, resta y niega en la misma moneda', () => {
    expect(add(money(150, 'USD'), money(75, 'USD'))).toEqual(money(225, 'USD'));
    expect(subtract(money(150, 'USD'), money(175, 'USD'))).toEqual(money(-25, 'USD'));
    expect(negate(money(40, 'EUR'))).toEqual(money(-40, 'EUR'));
    expect(sum('USD', [money(1, 'USD'), money(2, 'USD'), money(3, 'USD')])).toEqual(
      money(6, 'USD'),
    );
    expect(sum('USD', [])).toEqual(zero('USD'));
  });

  it('nunca mezcla monedas', () => {
    expect(() => add(money(1, 'USD'), money(1, 'EUR'))).toThrow(code('CURRENCY_MISMATCH'));
    expect(() => subtract(money(1, 'USD'), money(1, 'EUR'))).toThrow(code('CURRENCY_MISMATCH'));
    expect(() => compare(money(1, 'USD'), money(1, 'EUR'))).toThrow(code('CURRENCY_MISMATCH'));
    expect(() => sum('USD', [money(1, 'EUR')])).toThrow(code('CURRENCY_MISMATCH'));
  });

  it('detecta desbordes en lugar de perder precisión', () => {
    const max = money(Number.MAX_SAFE_INTEGER, 'USD');
    expect(() => add(max, money(1, 'USD'))).toThrow(code('AMOUNT_OUT_OF_RANGE'));
    expect(() => subtract(negate(max), money(1, 'USD'))).toThrow(code('AMOUNT_OUT_OF_RANGE'));
  });

  it('compara e identifica el cero', () => {
    expect(compare(money(1, 'USD'), money(2, 'USD'))).toBe(-1);
    expect(compare(money(2, 'USD'), money(2, 'USD'))).toBe(0);
    expect(compare(money(3, 'USD'), money(2, 'USD'))).toBe(1);
    expect(equals(money(2, 'USD'), money(2, 'USD'))).toBe(true);
    expect(equals(money(2, 'USD'), money(2, 'EUR'))).toBe(false);
    expect(isZero(zero('USD'))).toBe(true);
    expect(isZero(money(-1, 'USD'))).toBe(false);
  });

  describe('texto decimal', () => {
    it('lee montos según los decimales de la moneda', () => {
      expect(parseMoney('12.34', 'USD')).toEqual(money(1234, 'USD'));
      expect(parseMoney('12.3', 'USD')).toEqual(money(1230, 'USD'));
      expect(parseMoney('12', 'USD')).toEqual(money(1200, 'USD'));
      expect(parseMoney('-0.01', 'USD')).toEqual(money(-1, 'USD'));
      expect(parseMoney('1000', 'JPY')).toEqual(money(1000, 'JPY'));
      expect(parseMoney('1.234', 'KWD')).toEqual(money(1234, 'KWD'));
    });

    it('rechaza texto mal formado o con más decimales de los permitidos', () => {
      for (const bad of ['', ' 1', '1,5', '1.', '.5', '1e3', 'abc', '--1']) {
        expect(() => parseMoney(bad, 'USD')).toThrow(code('INVALID_AMOUNT'));
      }
      expect(() => parseMoney('1.234', 'USD')).toThrow(code('INVALID_AMOUNT'));
      expect(() => parseMoney('1.5', 'JPY')).toThrow(code('INVALID_AMOUNT'));
      expect(() => parseMoney('99999999999999999999', 'USD')).toThrow(code('AMOUNT_OUT_OF_RANGE'));
    });

    it('rechaza textos demasiado largos sin intentar convertirlos', () => {
      // 24 caracteres alcanzan para cualquier entero seguro con signo y tres decimales.
      expect(parseMoney('-' + '0'.repeat(19) + '1.23', 'USD')).toEqual(money(-123, 'USD'));
      expect(() => parseMoney('1'.repeat(25), 'USD')).toThrow(code('INVALID_AMOUNT'));
      const started = Date.now();
      expect(() => parseMoney('9'.repeat(1_000_000), 'USD')).toThrow(code('INVALID_AMOUNT'));
      expect(Date.now() - started).toBeLessThan(50);
    });

    it('escribe montos en texto decimal canónico', () => {
      expect(toDecimalString(money(1234, 'USD'))).toBe('12.34');
      expect(toDecimalString(money(5, 'USD'))).toBe('0.05');
      expect(toDecimalString(money(-5, 'USD'))).toBe('-0.05');
      expect(toDecimalString(money(1000, 'JPY'))).toBe('1000');
      expect(toDecimalString(money(1, 'KWD'))).toBe('0.001');
    });

    it('leer lo escrito devuelve el mismo monto', () => {
      fc.assert(
        fc.property(safeAmount, fc.constantFrom('USD', 'JPY', 'KWD'), (amount, currency) => {
          const value = money(amount, currency);
          expect(parseMoney(toDecimalString(value), currency)).toEqual(value);
        }),
      );
    });
  });

  it('sumar y restar son operaciones inversas', () => {
    fc.assert(
      fc.property(safeAmount, safeAmount, (a, b) => {
        const x = money(a, 'USD');
        const y = money(b, 'USD');
        expect(subtract(add(x, y), y)).toEqual(x);
      }),
    );
  });
});
