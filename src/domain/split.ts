import { allocate, assertUniqueMembers, type MemberAmount, type MemberId } from './allocate';
import { DomainError } from './errors';
import type { Money } from './money';

export type { MemberAmount, MemberId } from './allocate';

/** Las cuatro formas de dividir un gasto entre los miembros del grupo. */
export type SplitInput =
  | { readonly method: 'equal'; readonly participants: readonly MemberId[] }
  | { readonly method: 'exact'; readonly amounts: readonly MemberAmount[] }
  | {
      readonly method: 'percentage';
      /** Puntos básicos: 1 % = 100. Deben sumar 10 000. */
      readonly percentages: readonly {
        readonly memberId: MemberId;
        readonly basisPoints: number;
      }[];
    }
  | {
      readonly method: 'shares';
      /** Partes enteras positivas: 1 y 2 significa un tercio y dos tercios. */
      readonly shares: readonly { readonly memberId: MemberId; readonly shares: number }[];
    };

export type SplitMethod = SplitInput['method'];

const BASIS_POINTS_TOTAL = 10_000;

function invalidSplit(message: string): never {
  throw new DomainError('INVALID_SPLIT', message);
}

/** Divide un total positivo. La suma de las partes es siempre igual al total. */
export function splitAmount(total: Money, input: SplitInput): MemberAmount[] {
  if (total.amount <= 0) {
    throw new DomainError('INVALID_AMOUNT', 'El total a dividir debe ser positivo');
  }
  switch (input.method) {
    case 'equal':
      return allocate(
        total.amount,
        input.participants.map((memberId) => ({ memberId, weight: 1n })),
      );
    case 'shares':
      for (const { shares } of input.shares) {
        if (!Number.isSafeInteger(shares) || shares <= 0) {
          invalidSplit(`Las partes deben ser enteros positivos: ${shares}`);
        }
      }
      return allocate(
        total.amount,
        input.shares.map(({ memberId, shares }) => ({ memberId, weight: BigInt(shares) })),
      );
    case 'percentage': {
      let sumBasisPoints = 0;
      for (const { basisPoints } of input.percentages) {
        if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > BASIS_POINTS_TOTAL) {
          invalidSplit(`Porcentaje inválido en puntos básicos: ${basisPoints}`);
        }
        sumBasisPoints += basisPoints;
      }
      if (sumBasisPoints !== BASIS_POINTS_TOTAL) {
        invalidSplit(`Los porcentajes deben sumar 100 %: suman ${sumBasisPoints / 100} %`);
      }
      return allocate(
        total.amount,
        input.percentages.map(({ memberId, basisPoints }) => ({
          memberId,
          weight: BigInt(basisPoints),
        })),
      );
    }
    case 'exact': {
      assertUniqueMembers(
        input.amounts.map((a) => a.memberId),
        'INVALID_SPLIT',
      );
      let sumAmounts = 0n;
      for (const { amount } of input.amounts) {
        if (!Number.isSafeInteger(amount) || amount < 0) {
          invalidSplit(`Monto exacto inválido: ${amount}`);
        }
        sumAmounts += BigInt(amount);
      }
      if (sumAmounts !== BigInt(total.amount)) {
        invalidSplit('Los montos exactos deben sumar el total');
      }
      return input.amounts.map(({ memberId, amount }) => ({ memberId, amount }));
    }
  }
}

/**
 * Valida los pagadores de un gasto: uno o más, sin repetir, con montos positivos que suman
 * exactamente el total.
 */
export function validatePayers(total: Money, payers: readonly MemberAmount[]): MemberAmount[] {
  assertUniqueMembers(
    payers.map((p) => p.memberId),
    'INVALID_PAYERS',
  );
  let paid = 0n;
  for (const { amount } of payers) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new DomainError('INVALID_PAYERS', `Monto pagado inválido: ${amount}`);
    }
    paid += BigInt(amount);
  }
  if (paid !== BigInt(total.amount)) {
    throw new DomainError('INVALID_PAYERS', 'Lo pagado debe sumar el total del gasto');
  }
  return payers.map(({ memberId, amount }) => ({ memberId, amount }));
}
