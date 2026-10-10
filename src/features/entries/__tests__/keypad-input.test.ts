import { currencyCode } from '@/domain';
import type { KeypadKey } from '@/ui';

import { applyKey, displayExpression, hasOperator } from '../keypad-input';

const USD = currencyCode('USD');
const JPY = currencyCode('JPY');

const type = (keys: readonly KeypadKey[], currency = USD, start = '') =>
  keys.reduce((expression, key) => applyKey(expression, key, currency), start);

describe('teclado de la calculadora', () => {
  it('escribe números y operaciones', () => {
    expect(type(['1', '2', '.', '5', '0', '+', '8', '*', '2'])).toBe('12.50+8*2');
  });

  it('no deja empezar con un operador y reemplaza el operador repetido', () => {
    expect(type(['+'])).toBe('');
    expect(type(['5', '+', '*'])).toBe('5*');
    expect(type(['5', '-', '/', '+'])).toBe('5+');
  });

  it('limita el punto y los decimales a lo que admite la moneda', () => {
    expect(type(['.', '5'])).toBe('0.5');
    expect(type(['1', '.', '.', '2', '3', '4'])).toBe('1.23');
    expect(type(['1', '+', '.', '9'])).toBe('1+0.9');
    expect(type(['1', '.', '5'], JPY)).toBe('15');
  });

  it('quita los ceros a la izquierda', () => {
    expect(type(['0', '0', '7'])).toBe('7');
    expect(type(['5', '+', '0', '3'])).toBe('5+3');
    expect(type(['0', '.', '0', '5'])).toBe('0.05');
  });

  it('borra, limpia y resuelve con igual', () => {
    expect(type(['1', '2', 'back'])).toBe('1');
    expect(type(['1', '2', 'clear'])).toBe('');
    expect(type(['1', '0', '/', '4', 'equals'])).toBe('2.50');
    expect(type(['1', '2', '+', 'equals'])).toBe('12+');
    expect(type(['5', 'done'])).toBe('5');
  });

  it('no supera el largo máximo de la operación', () => {
    const long = '1+'.repeat(31) + '11';
    expect(applyKey(long, '1', USD)).toBe(long);
  });

  it('muestra la operación con el separador del idioma y signos legibles', () => {
    expect(displayExpression('12.5+8*2-1/4', ',')).toBe('12,5 + 8 × 2 − 1 ÷ 4');
    expect(hasOperator('12.5')).toBe(false);
    expect(hasOperator('12.5*2')).toBe(true);
  });
});
