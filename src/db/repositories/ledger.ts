import {
  computeBalances,
  currencyCode,
  settle,
  type Balance,
  type CurrencyCode,
  type LedgerEntry,
  type Transfer,
} from '@/domain';

import { listExpensesWithParts } from './expenses';
import { listMembers, type Group } from './queries';
import { listTransfers } from './transfers';
import type { AppDatabase } from './types';

export interface GroupBalances {
  readonly currency: CurrencyCode;
  /** Un saldo por miembro activo, más los quitados que todavía aparecen en movimientos. */
  readonly balances: Balance[];
  /** Transferencias sugeridas para saldar el grupo, mínimas y deterministas. */
  readonly settlement: Transfer[];
}

/** Saldos del grupo en su moneda y la liquidación sugerida, calculados con el dominio. */
export function computeGroupBalances(db: AppDatabase, group: Group): GroupBalances {
  const memberIds = listMembers(db, group.id).map((m) => m.id);
  const entries: LedgerEntry[] = listExpensesWithParts(db, group.id).map((expense) => {
    const shares = expense.splits.map((s) => ({ memberId: s.memberId, amount: s.groupAmount }));
    const holders = expense.payers.map((p) => ({ memberId: p.memberId, amount: p.groupAmount }));
    return expense.kind === 'expense'
      ? { kind: 'expense', payers: holders, shares }
      : { kind: 'income', receivers: holders, shares };
  });
  for (const transfer of listTransfers(db, group.id)) {
    entries.push({
      kind: 'transfer',
      from: transfer.fromMemberId,
      to: transfer.toMemberId,
      amount: transfer.groupAmount,
    });
  }
  const balances = computeBalances(group.currency, entries, memberIds);
  return { currency: currencyCode(group.currency), balances, settlement: settle(balances) };
}
