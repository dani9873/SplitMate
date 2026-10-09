import { compareIds, type MemberAmount, type MemberId } from './allocate';
import { currencyCode } from './currency';
import { DomainError } from './errors';
import { checkAmount, type Money } from './money';

/**
 * Movimiento del grupo ya expresado en la moneda del grupo, en unidades menores.
 *
 * - `expense`: los pagadores adelantaron el dinero y los participantes lo consumieron.
 * - `income`: los receptores recibieron dinero que pertenece a los participantes.
 * - `transfer`: `from` le pagó a `to` para saldar deudas.
 */
export type LedgerEntry =
  | {
      readonly kind: 'expense';
      readonly payers: readonly MemberAmount[];
      readonly shares: readonly MemberAmount[];
    }
  | {
      readonly kind: 'income';
      readonly receivers: readonly MemberAmount[];
      readonly shares: readonly MemberAmount[];
    }
  | {
      readonly kind: 'transfer';
      readonly from: MemberId;
      readonly to: MemberId;
      readonly amount: number;
    };

/** Saldo de un miembro: positivo si el grupo le debe, negativo si debe al grupo. */
export interface Balance {
  readonly memberId: MemberId;
  readonly amount: Money;
}

function total(items: readonly MemberAmount[]): bigint {
  return items.reduce((acc, item) => acc + BigInt(checkAmount(item.amount)), 0n);
}

/**
 * Calcula el saldo de cada miembro: lo pagado menos lo consumido, en la moneda del grupo.
 * Los saldos siempre suman cero. Devuelve los miembros ordenados por `memberId`, incluidos
 * los de `members` sin movimientos, con saldo cero.
 */
export function computeBalances(
  currency: string,
  entries: readonly LedgerEntry[],
  members: readonly MemberId[] = [],
): Balance[] {
  const code = currencyCode(currency);
  const totals = new Map<MemberId, bigint>(members.map((id) => [id, 0n]));
  const credit = (memberId: MemberId, amount: bigint) =>
    totals.set(memberId, (totals.get(memberId) ?? 0n) + amount);

  for (const entry of entries) {
    if (entry.kind === 'transfer') {
      if (entry.from === entry.to || checkAmount(entry.amount) <= 0) {
        throw new DomainError('INVALID_TRANSFER', 'Transferencia a uno mismo o sin monto');
      }
      credit(entry.from, BigInt(entry.amount));
      credit(entry.to, -BigInt(entry.amount));
      continue;
    }
    const holders = entry.kind === 'expense' ? entry.payers : entry.receivers;
    if (total(holders) !== total(entry.shares)) {
      throw new DomainError('UNBALANCED', 'Lo pagado no coincide con lo repartido');
    }
    const sign = entry.kind === 'expense' ? 1n : -1n;
    for (const { memberId, amount } of holders) {
      credit(memberId, sign * BigInt(amount));
    }
    for (const { memberId, amount } of entry.shares) {
      credit(memberId, -sign * BigInt(amount));
    }
  }

  return [...totals.entries()]
    .sort(([a], [b]) => compareIds(a, b))
    .map(([memberId, amount]) => {
      if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new DomainError('AMOUNT_OUT_OF_RANGE', 'Saldo fuera de rango');
      }
      return { memberId, amount: { amount: Number(amount), currency: code } };
    });
}
