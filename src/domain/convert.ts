import { allocate, type MemberAmount } from './allocate';
import { currencyCode, minorUnits } from './currency';
import { DomainError } from './errors';
import { checkAmount, type Money } from './money';

/** Tasa de cambio como fracción exacta: `"0.9214"` es 9214 / 10000. */
export interface Rate {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const RATE_PATTERN = /^\d+(\.\d+)?$/;
const MAX_RATE_LENGTH = 32;

/** Lee una tasa decimal positiva, con punto y sin exponentes. */
export function parseRate(rate: string): Rate {
  if (rate.length > MAX_RATE_LENGTH || !RATE_PATTERN.test(rate)) {
    throw new DomainError('INVALID_RATE', `Tasa mal formada: "${rate}"`);
  }
  const dot = rate.indexOf('.');
  const whole = dot === -1 ? rate : rate.slice(0, dot);
  const fraction = dot === -1 ? '' : rate.slice(dot + 1);
  const numerator = BigInt(whole + fraction);
  if (numerator === 0n) {
    throw new DomainError('INVALID_RATE', 'La tasa debe ser mayor que cero');
  }
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

/** Divide `numerator / denominator` redondeando al entero más cercano y los empates al par. */
function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const twiceRemainder = (magnitude % denominator) * 2n;
  if (twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n === 1n)) {
    quotient += 1n;
  }
  return negative ? -quotient : quotient;
}

/**
 * Convierte un monto a otra moneda con una tasa decimal, en aritmética exacta.
 * `destino = monto × tasa × 10^decimales destino / 10^decimales origen`, con redondeo bancario.
 */
export function convert(amount: Money, to: string, rate: string): Money {
  const target = currencyCode(to);
  const { numerator, denominator } = parseRate(rate);
  const scaleUp = 10n ** BigInt(minorUnits(target));
  const scaleDown = 10n ** BigInt(minorUnits(amount.currency));
  const exact = divideHalfEven(
    BigInt(amount.amount) * numerator * scaleUp,
    denominator * scaleDown,
  );
  if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainError('AMOUNT_OUT_OF_RANGE', 'El monto convertido está fuera de rango');
  }
  return { amount: checkAmount(Number(exact)), currency: target };
}

/**
 * Convierte las partes de un gasto repartiendo el total ya convertido en proporción a las
 * partes originales, con el mismo mayor residuo de la división. Así las partes convertidas
 * suman exactamente el total convertido, cosa que no garantiza convertir cada parte por
 * separado.
 */
export function convertParts(
  parts: readonly MemberAmount[],
  convertedTotal: Money,
): MemberAmount[] {
  return allocate(
    convertedTotal.amount,
    parts.map(({ memberId, amount }) => ({ memberId, weight: BigInt(amount) })),
  );
}
