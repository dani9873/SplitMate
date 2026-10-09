import {
  computeBalances,
  currencyCode,
  settle,
  type Balance,
  type CurrencyCode,
  type LedgerEntry,
  type Transfer,
} from '@/domain';

import { createExpensesRepository } from './expenses';
import {
  createGroupsRepository,
  createMembersRepository,
  createUsersRepository,
  listMembers,
  requireGroup,
} from './groups';
import { createTransfersRepository } from './transfers';
import type { AppDatabase, RepositoryDeps } from './types';

export interface GroupBalances {
  readonly currency: CurrencyCode;
  readonly balances: Balance[];
  /** Transferencias sugeridas para saldar el grupo, mínimas y deterministas. */
  readonly settlement: Transfer[];
}

/**
 * Punto de entrada al acceso a datos. Los componentes nunca escriben SQL: usan estos
 * repositorios, que validan con zod y calculan con el dominio.
 */
export function createRepositories(db: AppDatabase, deps: RepositoryDeps) {
  const expenses = createExpensesRepository(db, deps);
  const transfers = createTransfersRepository(db, deps);

  return {
    users: createUsersRepository(db, deps),
    groups: createGroupsRepository(db, deps),
    members: createMembersRepository(db),
    expenses,
    transfers,
    balances: {
      /** Saldos del grupo en su moneda y la liquidación sugerida. */
      forGroup(groupId: string): GroupBalances {
        const group = requireGroup(db, groupId);
        const memberIds = listMembers(db, group.id).map((m) => m.id);
        const entries: LedgerEntry[] = expenses.listByGroup(group.id).map((expense) => {
          const shares = expense.splits.map((s) => ({
            memberId: s.memberId,
            amount: s.groupAmount,
          }));
          const holders = expense.payers.map((p) => ({
            memberId: p.memberId,
            amount: p.groupAmount,
          }));
          return expense.kind === 'expense'
            ? { kind: 'expense', payers: holders, shares }
            : { kind: 'income', receivers: holders, shares };
        });
        for (const transfer of transfers.listByGroup(group.id)) {
          entries.push({
            kind: 'transfer',
            from: transfer.fromMemberId,
            to: transfer.toMemberId,
            amount: transfer.groupAmount,
          });
        }
        const balances = computeBalances(group.currency, entries, memberIds);
        return {
          currency: currencyCode(group.currency),
          balances,
          settlement: settle(balances),
        };
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
export { RepositoryError, type RepositoryErrorCode, type ValidationIssue } from './errors';
export type { AppDatabase, RepositoryDeps } from './types';
export type { Expense, ExpensePayer, ExpenseSplit, ExpenseWithParts } from './expenses';
export type { Group, Member, User } from './groups';
export type { TransferRow } from './transfers';
export type { AddExpenseInput, AddTransferInput, CreateGroupInput } from './validation';
