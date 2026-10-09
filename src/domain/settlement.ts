import { compareIds, type MemberId } from './allocate';
import type { Balance } from './balances';
import { DomainError } from './errors';
import { assertSameCurrency, type Money } from './money';

/** Pago sugerido: `from` le paga `amount` a `to`. */
export interface Transfer {
  readonly from: MemberId;
  readonly to: MemberId;
  readonly amount: Money;
}

/**
 * Máximo de miembros con saldo distinto de cero que se resuelven de forma exacta.
 * La DP usa O(2ⁿ) memoria y O(2ⁿ · n) tiempo; por encima del límite se usa el voraz.
 */
export const EXACT_SETTLEMENT_LIMIT = 20;

/** Tope duro: con más bits la tabla de la DP no cabe razonablemente en memoria. */
const HARD_LIMIT = 24;

interface Position {
  readonly memberId: MemberId;
  readonly amount: number;
}

interface PlainTransfer {
  readonly from: MemberId;
  readonly to: MemberId;
  readonly amount: number;
}

/**
 * Propone la lista mínima de transferencias que deja todos los saldos en cero.
 *
 * Con `k` subgrupos disjuntos que suman cero hacen falta `n − k` transferencias, así que el
 * mínimo se obtiene maximizando `k`, un problema NP-difícil. Hasta `exactLimit` miembros con
 * saldo se resuelve exacto con programación dinámica sobre subconjuntos; cada subgrupo se
 * liquida luego con un voraz que usa `tamaño − 1` transferencias. Por encima del límite, o si
 * los montos son tan grandes que sus sumas dejarían de ser exactas, se aplica el voraz al
 * grupo completo, que usa como máximo `n − 1`.
 *
 * Es determinista: la entrada se ordena por `memberId`, los empates se rompen por monto y
 * luego por `memberId`, y la salida se ordena por pagador y receptor.
 */
export function settle(
  balances: readonly Balance[],
  options: { readonly exactLimit?: number } = {},
): Transfer[] {
  const [first] = balances;
  if (!first) {
    return [];
  }
  const ids = new Set<MemberId>();
  let total = 0n;
  let magnitude = 0n;
  for (const balance of balances) {
    assertSameCurrency(first.amount, balance.amount);
    if (ids.has(balance.memberId)) {
      throw new DomainError('DUPLICATE_MEMBER', `Miembro repetido: ${balance.memberId}`);
    }
    ids.add(balance.memberId);
    total += BigInt(balance.amount.amount);
    magnitude += BigInt(Math.abs(balance.amount.amount));
  }
  if (total !== 0n) {
    throw new DomainError('UNBALANCED', 'Los saldos deben sumar cero');
  }

  const positions: Position[] = balances
    .filter((b) => b.amount.amount !== 0)
    .map((b) => ({ memberId: b.memberId, amount: b.amount.amount }))
    .sort((a, b) => compareIds(a.memberId, b.memberId));

  const limit = Math.min(options.exactLimit ?? EXACT_SETTLEMENT_LIMIT, HARD_LIMIT);
  const exact = positions.length <= limit && magnitude <= BigInt(Number.MAX_SAFE_INTEGER);
  const groups = exact ? zeroSumGroups(positions) : [positions];

  return groups
    .flatMap(settleGreedy)
    .sort((a, b) => compareIds(a.from, b.from) || compareIds(a.to, b.to))
    .map(({ from, to, amount }) => ({
      from,
      to,
      amount: { amount, currency: first.amount.currency },
    }));
}

/**
 * Parte las posiciones en la mayor cantidad posible de subgrupos que suman cero.
 *
 * `best[mask]` es el máximo de prefijos de suma cero en una cadena que quita un miembro a la
 * vez desde `mask` hasta el vacío. Recorrer la cadena óptima desde el grupo completo y cortar
 * cada vez que la suma vuelve a cero produce exactamente `best[completo]` subgrupos.
 */
function zeroSumGroups(positions: readonly Position[]): Position[][] {
  const n = positions.length;
  const size = 1 << n;
  // Sumas exactas: el llamador garantiza que la suma de magnitudes es un entero seguro.
  const sums = new Float64Array(size);
  const best = new Int8Array(size);
  const choice = new Int8Array(size);

  for (let mask = 1; mask < size; mask++) {
    const lowest = mask & -mask;
    sums[mask] = sums[mask ^ lowest]! + positions[31 - Math.clz32(lowest)]!.amount;
    let bestValue = -1;
    let bestIndex = 0;
    for (let rest = mask; rest !== 0; rest &= rest - 1) {
      const bit = rest & -rest;
      const value = best[mask ^ bit]!;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = 31 - Math.clz32(bit);
      }
    }
    best[mask] = bestValue + (sums[mask] === 0 ? 1 : 0);
    choice[mask] = bestIndex;
  }

  const groups: Position[][] = [];
  let current: Position[] = [];
  for (let mask = size - 1; mask !== 0;) {
    const index = choice[mask]!;
    current.push(positions[index]!);
    mask ^= 1 << index;
    if (sums[mask] === 0) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

/** Empareja al mayor deudor con el mayor acreedor hasta saldar. Desempata por `memberId`. */
function settleGreedy(group: readonly Position[]): PlainTransfer[] {
  const byLargest = (a: { amount: number; memberId: MemberId }, b: typeof a) =>
    b.amount - a.amount || compareIds(a.memberId, b.memberId);
  let creditors = group.filter((p) => p.amount > 0).map((p) => ({ ...p }));
  let debtors = group.filter((p) => p.amount < 0).map((p) => ({ ...p, amount: -p.amount }));
  const transfers: PlainTransfer[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byLargest);
    debtors.sort(byLargest);
    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = Math.min(creditor.amount, debtor.amount);
    transfers.push({ from: debtor.memberId, to: creditor.memberId, amount });
    creditor.amount -= amount;
    debtor.amount -= amount;
    creditors = creditors.filter((c) => c.amount > 0);
    debtors = debtors.filter((d) => d.amount > 0);
  }
  return transfers;
}
