import * as fc from 'fast-check';

import {
  evaluateAmount,
  MAX_AMOUNT_INTEGER_DIGITS,
  MAX_EXPRESSION_LENGTH,
  type AmountProblem,
} from '../expression';
import { money } from '../money';

const ok = (amount: number, currency: string) => ({ ok: true, value: money(amount, currency) });
const problem = (reason: AmountProblem) => ({ ok: false, problem: reason });

describe('evaluateAmount', () => {
  describe('calcula montos exactos en unidades menores', () => {
    it.each([
      ['28.5', 'USD', 2850],
      ['12.50+8*2', 'USD', 2850],
      ['2+3*4', 'USD', 1400],
      ['8/2*4', 'USD', 1600],
      ['10-2-3', 'USD', 500],
      ['100-20/4', 'USD', 9500],
      ['0.1+0.2', 'USD', 30],
      ['12.', 'USD', 1200],
      ['.5', 'USD', 50],
      ['1500', 'JPY', 1500],
      ['0.125*2', 'KWD', 250],
      ['007', 'USD', 700],
    ])('%s %s = %i', (expression, currency, amount) => {
      expect(evaluateAmount(expression, currency)).toEqual(ok(amount, currency));
    });

    it('redondea una sola vez, al final: 10/3 USD son 3,33', () => {
      expect(evaluateAmount('10/3', 'USD')).toEqual(ok(333, 'USD'));
      // Redondear cada paso daría 3,33 × 3 = 9,99; el valor exacto es 10.
      expect(evaluateAmount('10/3*3', 'USD')).toEqual(ok(1000, 'USD'));
    });

    it('usa redondeo bancario: los empates van al par', () => {
      expect(evaluateAmount('2.5*3', 'JPY')).toEqual(problem('TOO_MANY_DECIMALS'));
      expect(evaluateAmount('15/2', 'JPY')).toEqual(ok(8, 'JPY'));
      expect(evaluateAmount('25/2', 'JPY')).toEqual(ok(12, 'JPY'));
      expect(evaluateAmount('0.25/2', 'USD')).toEqual(ok(12, 'USD'));
      expect(evaluateAmount('0.35/2', 'USD')).toEqual(ok(18, 'USD'));
    });
  });

  describe('explica por qué no hay monto', () => {
    it.each<[string, string, AmountProblem]>([
      ['', 'USD', 'EMPTY'],
      ['12+', 'USD', 'INCOMPLETE'],
      ['12*', 'USD', 'INCOMPLETE'],
      ['5-3/', 'USD', 'INCOMPLETE'],
      ['+5', 'USD', 'MALFORMED'],
      ['-5', 'USD', 'MALFORMED'],
      ['1..2', 'USD', 'MALFORMED'],
      ['1.2.3', 'USD', 'MALFORMED'],
      ['.', 'USD', 'MALFORMED'],
      ['5++3', 'USD', 'MALFORMED'],
      ['5 + 3', 'USD', 'MALFORMED'],
      ['5,3', 'USD', 'MALFORMED'],
      ['1e3', 'USD', 'MALFORMED'],
      ['(5)', 'USD', 'MALFORMED'],
      ['1.234', 'USD', 'TOO_MANY_DECIMALS'],
      ['1+0.001', 'USD', 'TOO_MANY_DECIMALS'],
      ['1.5', 'JPY', 'TOO_MANY_DECIMALS'],
      ['1.2345', 'KWD', 'TOO_MANY_DECIMALS'],
      ['12/0', 'USD', 'DIVISION_BY_ZERO'],
      ['12/0.00', 'USD', 'DIVISION_BY_ZERO'],
      ['5+12/0*3', 'USD', 'DIVISION_BY_ZERO'],
      ['0', 'USD', 'NOT_POSITIVE'],
      ['5-5', 'USD', 'NOT_POSITIVE'],
      ['5-8', 'USD', 'NOT_POSITIVE'],
      ['0.01/3', 'USD', 'NOT_POSITIVE'],
      ['10000000000', 'USD', 'TOO_LARGE'],
      ['99999*999999', 'USD', 'TOO_LARGE'],
    ])('%p en %s → %s', (expression, currency, reason) => {
      expect(evaluateAmount(expression, currency)).toEqual(problem(reason));
    });

    it('acepta hasta diez dígitos enteros', () => {
      expect(MAX_AMOUNT_INTEGER_DIGITS).toBe(10);
      expect(evaluateAmount('9999999999.99', 'USD')).toEqual(ok(999_999_999_999, 'USD'));
      expect(evaluateAmount('9999999999.995', 'USD')).toEqual(problem('TOO_MANY_DECIMALS'));
      expect(evaluateAmount('9999999999.99+0.01', 'USD')).toEqual(problem('TOO_LARGE'));
      expect(evaluateAmount('9999999999.999', 'KWD')).toEqual(ok(9_999_999_999_999, 'KWD'));
    });

    it('rechaza expresiones demasiado largas antes de analizarlas', () => {
      const long = '1+'.repeat(MAX_EXPRESSION_LENGTH / 2) + '1';
      expect(long.length).toBeGreaterThan(MAX_EXPRESSION_LENGTH);
      expect(evaluateAmount(long, 'USD')).toEqual(problem('TOO_LONG'));
      expect(evaluateAmount('1'.repeat(10_000), 'USD')).toEqual(problem('TOO_LONG'));
      const atLimit = '1+'.repeat(MAX_EXPRESSION_LENGTH / 2 - 1) + '11';
      expect(atLimit).toHaveLength(MAX_EXPRESSION_LENGTH);
      expect(evaluateAmount(atLimit, 'USD').ok).toBe(true);
    });

    it('falla con UNKNOWN_CURRENCY ante una moneda desconocida', () => {
      expect(() => evaluateAmount('5', 'XYZ')).toThrow(
        expect.objectContaining({ code: 'UNKNOWN_CURRENCY' }),
      );
    });
  });

  describe('propiedades', () => {
    const cents = fc.integer({ min: 1, max: 99_999_999 });
    const text = (value: number) =>
      `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`;

    it('a + b es la suma exacta de los dos montos', () => {
      fc.assert(
        fc.property(cents, cents, (a, b) => {
          expect(evaluateAmount(`${text(a)}+${text(b)}`, 'USD')).toEqual(ok(a + b, 'USD'));
        }),
      );
    });

    it('a × n ÷ n devuelve a', () => {
      fc.assert(
        fc.property(cents, fc.integer({ min: 1, max: 999 }), (a, n) => {
          expect(evaluateAmount(`${text(a)}*${n}/${n}`, 'USD')).toEqual(ok(a, 'USD'));
        }),
      );
    });
  });
});
