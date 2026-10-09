import { DomainError } from './errors';
import { checkAmount } from './money';

export type MemberId = string;

export interface MemberAmount {
  readonly memberId: MemberId;
  readonly amount: number;
}

export interface Weight {
  readonly memberId: MemberId;
  readonly weight: bigint;
}

/** Orden binario de cadenas: no depende del idioma ni del dispositivo. */
export function compareIds(a: MemberId, b: MemberId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function assertUniqueMembers(
  ids: readonly MemberId[],
  code: 'INVALID_SPLIT' | 'INVALID_PAYERS',
) {
  if (ids.length === 0) {
    throw new DomainError(code, 'Se necesita al menos un miembro');
  }
  if (new Set(ids).size !== ids.length) {
    throw new DomainError(code, 'Hay miembros repetidos');
  }
}

/**
 * Reparte `total` en proporción a los pesos con el método del mayor residuo.
 *
 * 1. Cada miembro recibe la parte entera de `total × peso / suma de pesos`.
 * 2. Las unidades sobrantes se entregan de una en una, por fracción descartada de mayor a menor.
 * 3. Los empates se resuelven por `memberId` ascendente, así el resultado no depende del orden
 *    de entrada.
 *
 * La suma de las partes es siempre igual a `total`. Los totales negativos se reparten como
 * su valor absoluto y luego se niegan. Devuelve las partes en el orden de `weights`.
 */
export function allocate(total: number, weights: readonly Weight[]): MemberAmount[] {
  checkAmount(total);
  assertUniqueMembers(
    weights.map((w) => w.memberId),
    'INVALID_SPLIT',
  );
  if (weights.some((w) => w.weight < 0n)) {
    throw new DomainError('INVALID_SPLIT', 'Los pesos no pueden ser negativos');
  }
  const weightSum = weights.reduce((acc, w) => acc + w.weight, 0n);
  if (weightSum === 0n) {
    throw new DomainError('INVALID_SPLIT', 'Algún peso debe ser positivo');
  }

  const magnitude = BigInt(Math.abs(total));
  const parts = weights.map((w) => (magnitude * w.weight) / weightSum);
  const remainders = weights.map((w) => (magnitude * w.weight) % weightSum);
  let leftover = magnitude - parts.reduce((acc, p) => acc + p, 0n);

  const order = weights
    .map((_, index) => index)
    .sort((i, j) => {
      const byRemainder = remainders[j]! - remainders[i]!;
      if (byRemainder !== 0n) {
        return byRemainder > 0n ? 1 : -1;
      }
      return compareIds(weights[i]!.memberId, weights[j]!.memberId);
    });
  for (const index of order) {
    if (leftover === 0n) {
      break;
    }
    parts[index] = parts[index]! + 1n;
    leftover -= 1n;
  }

  return weights.map((w, i) => {
    const amount = Number(parts[i]);
    return { memberId: w.memberId, amount: total < 0 && amount !== 0 ? -amount : amount };
  });
}
