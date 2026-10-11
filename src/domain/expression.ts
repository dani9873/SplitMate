import { currencyCode, minorUnits } from './currency';
import type { Money } from './money';
import { divideHalfEven } from './rounding';

/** Símbolos máximos de la operación. Se comprueba antes de analizarla. */
export const MAX_EXPRESSION_LENGTH = 64;

/** Dígitos enteros máximos del resultado: hasta 9 999 999 999 en la unidad principal. */
export const MAX_AMOUNT_INTEGER_DIGITS = 10;

/** Por qué una operación no da un monto válido. La UI traduce cada motivo. */
export type AmountProblem =
  | 'EMPTY'
  | 'INCOMPLETE'
  | 'MALFORMED'
  | 'TOO_MANY_DECIMALS'
  | 'DIVISION_BY_ZERO'
  | 'NOT_POSITIVE'
  | 'TOO_LARGE'
  | 'TOO_LONG';

export type AmountEvaluation =
  | { readonly ok: true; readonly value: Money }
  | { readonly ok: false; readonly problem: AmountProblem };

type Operator = '+' | '-' | '*' | '/';

/** Fracción exacta con denominador positivo. */
interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

type Step<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: AmountProblem };

const TOKEN = /\d+(?:\.\d*)?|\.\d+|[+\-*/]/y;
const OPERATORS = new Set<string>(['+', '-', '*', '/']);

const failure = (problem: AmountProblem) => ({ ok: false, problem }) as const;
const success = <T>(value: T) => ({ ok: true, value }) as const;

function tokenize(expression: string): Step<string[]> {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < expression.length) {
    const match = TOKEN.exec(expression);
    if (!match) {
      return failure('MALFORMED');
    }
    tokens.push(match[0]);
  }
  return success(tokens);
}

function parseNumber(token: string, decimals: number): Step<Rational> {
  const dot = token.indexOf('.');
  const whole = dot === -1 ? token : token.slice(0, dot);
  const fraction = dot === -1 ? '' : token.slice(dot + 1);
  if (fraction.length > decimals) {
    return failure('TOO_MANY_DECIMALS');
  }
  return success({ n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) });
}

function apply(left: Rational, operator: Operator, right: Rational): Step<Rational> {
  switch (operator) {
    case '+':
      return success({ n: left.n * right.d + right.n * left.d, d: left.d * right.d });
    case '-':
      return success({ n: left.n * right.d - right.n * left.d, d: left.d * right.d });
    case '*':
      return success({ n: left.n * right.n, d: left.d * right.d });
    case '/':
      // Los números escritos no llevan signo, así que un divisor no nulo es positivo y el
      // denominador sigue siendo positivo.
      return right.n === 0n
        ? failure('DIVISION_BY_ZERO')
        : success({ n: left.n * right.d, d: left.d * right.n });
  }
}

/**
 * Valida la secuencia `número (operador número)*` y la evalúa con × y ÷ antes que + y −,
 * de izquierda a derecha.
 */
function evaluate(tokens: readonly string[], decimals: number): Step<Rational> {
  const operands: Rational[] = [];
  const operators: Operator[] = [];
  for (const [index, token] of tokens.entries()) {
    const expectsNumber = index % 2 === 0;
    if (OPERATORS.has(token) === expectsNumber) {
      return failure('MALFORMED');
    }
    if (!expectsNumber) {
      operators.push(token as Operator);
      continue;
    }
    const operand = parseNumber(token, decimals);
    if (!operand.ok) {
      return operand;
    }
    operands.push(operand.value);
  }
  if (operands.length === operators.length) {
    return failure('INCOMPLETE');
  }

  // Primera pasada: × y ÷ sobre términos consecutivos. Segunda: + y − de izquierda a derecha.
  const terms: Rational[] = operands.slice(0, 1);
  const additive: Operator[] = [];
  for (const [index, operator] of operators.entries()) {
    const right = operands[index + 1] as Rational;
    if (operator === '+' || operator === '-') {
      additive.push(operator);
      terms.push(right);
      continue;
    }
    const product = apply(terms.pop() as Rational, operator, right);
    if (!product.ok) {
      return product;
    }
    terms.push(product.value);
  }
  let result = terms[0] as Rational;
  for (const [index, operator] of additive.entries()) {
    // + y − nunca fallan: solo la división puede hacerlo.
    result = (apply(result, operator, terms[index + 1] as Rational) as { value: Rational }).value;
  }
  return success(result);
}

/**
 * Evalúa lo que se escribe en el campo de monto, como `12.50+8*2`, sin pasar por `float`.
 *
 * Admite dígitos, punto decimal y `+ - * /`, sin signos iniciales ni paréntesis. Cada número
 * respeta los decimales de la moneda. El cálculo es exacto con fracciones `bigint` y se
 * redondea una sola vez al final, con redondeo bancario. El resultado debe ser positivo y de
 * hasta diez dígitos enteros.
 *
 * Devuelve el motivo en lugar de lanzar: el formulario evalúa en cada tecla.
 */
export function evaluateAmount(expression: string, currency: string): AmountEvaluation {
  const code = currencyCode(currency);
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return failure('TOO_LONG');
  }
  if (expression.length === 0) {
    return failure('EMPTY');
  }
  const decimals = minorUnits(code);
  const tokens = tokenize(expression);
  if (!tokens.ok) {
    return tokens;
  }
  const exact = evaluate(tokens.value, decimals);
  if (!exact.ok) {
    return exact;
  }
  const minor = divideHalfEven(exact.value.n * 10n ** BigInt(decimals), exact.value.d);
  if (minor <= 0n) {
    return failure('NOT_POSITIVE');
  }
  if (minor >= 10n ** BigInt(MAX_AMOUNT_INTEGER_DIGITS + decimals)) {
    return failure('TOO_LARGE');
  }
  return success({ amount: Number(minor), currency: code });
}
