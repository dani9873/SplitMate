import { currencyCode, minorUnits, type CurrencyCode } from './currency';
import { DomainError } from './errors';

/** Monto en unidades menores de su moneda: 1234 USD son 12,34 dólares. */
export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/** Exige un entero seguro: los montos nunca son `float` ni pierden precisión. */
export function checkAmount(amount: number): number {
  if (!Number.isInteger(amount)) {
    throw new DomainError('INVALID_AMOUNT', `El monto debe ser un entero: ${amount}`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new DomainError('AMOUNT_OUT_OF_RANGE', `Monto fuera de rango: ${amount}`);
  }
  return amount;
}

export function money(amount: number, currency: string): Money {
  return { amount: checkAmount(amount), currency: currencyCode(currency) };
}

export function zero(currency: string): Money {
  return money(0, currency);
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new DomainError('CURRENCY_MISMATCH', `No se mezclan ${a.currency} y ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: checkAmount(a.amount + b.amount), currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: checkAmount(a.amount - b.amount), currency: a.currency };
}

export function negate(a: Money): Money {
  return { amount: 0 - a.amount, currency: a.currency };
}

export function sum(currency: string, items: readonly Money[]): Money {
  return items.reduce(add, zero(currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function isZero(a: Money): boolean {
  return a.amount === 0;
}

/**
 * Lee un monto en texto decimal con punto, como `"12.34"`, sin pasar por `float`.
 * Rechaza más decimales de los que admite la moneda.
 */
export function parseMoney(input: string, currency: string): Money {
  const code = currencyCode(currency);
  if (!DECIMAL_PATTERN.test(input)) {
    throw new DomainError('INVALID_AMOUNT', `Monto mal formado: "${input}"`);
  }
  const negative = input.startsWith('-');
  const [integerPart = '', fractionPart = ''] = (negative ? input.slice(1) : input).split('.');
  const decimals = minorUnits(code);
  if (fractionPart.length > decimals) {
    throw new DomainError('INVALID_AMOUNT', `${code} admite ${decimals} decimales: "${input}"`);
  }
  const minor = BigInt(integerPart + fractionPart.padEnd(decimals, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainError('AMOUNT_OUT_OF_RANGE', `Monto fuera de rango: "${input}"`);
  }
  const amount = Number(minor);
  return { amount: negative ? 0 - amount : amount, currency: code };
}

/** Escribe el monto en texto decimal canónico con punto: `"12.34"`, `"-0.05"`, `"1000"`. */
export function toDecimalString(m: Money): string {
  const decimals = minorUnits(m.currency);
  const digits = Math.abs(m.amount)
    .toString()
    .padStart(decimals + 1, '0');
  const sign = m.amount < 0 ? '-' : '';
  if (decimals === 0) {
    return sign + digits;
  }
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
