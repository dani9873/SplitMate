import {
  evaluateAmount,
  MAX_EXPRESSION_LENGTH,
  minorUnits,
  toDecimalString,
  type CurrencyCode,
} from '@/domain';
import type { KeypadKey } from '@/ui';

const OPERATORS = new Set(['+', '-', '*', '/']);

/** Número que se está escribiendo: lo que va después del último operador. */
function currentNumber(expression: string): string {
  const match = /[\d.]*$/.exec(expression);
  return match ? match[0] : '';
}

/**
 * Aplica una tecla del teclado a la expresión canónica (`12.5+8*2`). Evita lo que no tiene
 * sentido mientras se escribe: dos operadores seguidos, dos puntos en un número, más
 * decimales de los que admite la moneda o ceros a la izquierda. `=` reemplaza la operación
 * por su resultado si es válido.
 */
export function applyKey(expression: string, key: KeypadKey, currency: CurrencyCode): string {
  const decimals = minorUnits(currency);
  const last = expression.at(-1) ?? '';
  const number = currentNumber(expression);

  switch (key) {
    case 'back':
      return expression.slice(0, -1);
    case 'clear':
      return '';
    case 'done':
      return expression;
    case 'equals': {
      const result = evaluateAmount(expression, currency);
      return result.ok ? toDecimalString(result.value) : expression;
    }
    case '+':
    case '-':
    case '*':
    case '/':
      if (expression === '') {
        return expression;
      }
      return OPERATORS.has(last) ? expression.slice(0, -1) + key : append(expression, key);
    case '.':
      if (decimals === 0 || number.includes('.')) {
        return expression;
      }
      return append(expression, number === '' ? '0.' : '.');
    default: {
      const dot = number.indexOf('.');
      if (dot !== -1 && number.length - dot - 1 >= decimals) {
        return expression;
      }
      if (number === '0') {
        return expression.slice(0, -1) + key;
      }
      return append(expression, key);
    }
  }
}

function append(expression: string, text: string): string {
  const next = expression + text;
  return next.length > MAX_EXPRESSION_LENGTH ? expression : next;
}

/** La expresión para mostrar: separador decimal del idioma y signos ×, ÷ y −. */
export function displayExpression(expression: string, decimalSeparator: string): string {
  return expression
    .replace(/\./g, decimalSeparator)
    .replace(/\*/g, ' × ')
    .replace(/\//g, ' ÷ ')
    .replace(/-/g, ' − ')
    .replace(/\+/g, ' + ');
}

/** Verdadero si la expresión tiene alguna operación, para mostrar el resultado aparte. */
export function hasOperator(expression: string): boolean {
  return /[+\-*/]/.test(expression);
}
