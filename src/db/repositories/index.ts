import { createChangeBus, type ChangeBus, type ChangeSource } from '../changes';
import { createActivityRepository } from './activity';
import { createCategoriesRepository } from './categories';
import { createDraftsRepository } from './drafts';
import { createExpensesRepository } from './expenses';
import { createGroupsRepository, createUsersRepository } from './groups';
import { computeGroupBalances, type GroupBalances } from './ledger';
import { createMembersRepository } from './members';
import { createProfileRepository } from './profile';
import { requireGroup } from './queries';
import { createTransfersRepository } from './transfers';
import type { AppDatabase, RepositoryContext, RepositoryDeps } from './types';

export interface RepositoryOptions {
  /** Bus de cambios compartido con las pantallas. Por defecto, uno nuevo. */
  readonly bus?: ChangeBus;
  /** Origen de las escrituras: `sync` para la sincronización de la Fase 4. */
  readonly source?: ChangeSource;
}

/**
 * Punto de entrada al acceso a datos. Los componentes nunca escriben SQL: usan estos
 * repositorios, que validan con zod, calculan con el dominio y avisan cada escritura
 * confirmada en el bus de cambios.
 */
export function createRepositories(
  db: AppDatabase,
  deps: RepositoryDeps,
  { bus = createChangeBus(), source = 'local' }: RepositoryOptions = {},
) {
  const ctx: RepositoryContext = {
    db,
    deps,
    source,
    notify: (tables, groupIds) => bus.emit({ source, tables, groupIds }),
  };

  return {
    users: createUsersRepository(ctx),
    profile: createProfileRepository(ctx),
    groups: createGroupsRepository(ctx),
    members: createMembersRepository(ctx),
    categories: createCategoriesRepository(ctx),
    expenses: createExpensesRepository(ctx),
    transfers: createTransfersRepository(ctx),
    activity: createActivityRepository(ctx),
    drafts: createDraftsRepository(ctx),
    balances: {
      /** Saldos del grupo en su moneda y la liquidación sugerida. */
      forGroup(groupId: string): GroupBalances {
        return computeGroupBalances(db, requireGroup(db, groupId));
      },
    },
    /** Suscripción a los cambios y lotes que avisan una sola vez. */
    changes: { subscribe: bus.subscribe, batch: bus.batch },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
export {
  RepositoryError,
  type RepositoryErrorCode,
  type RepositoryErrorDetails,
  type ValidationIssue,
} from './errors';
export type { AppDatabase, RepositoryDeps } from './types';
export type {
  ActivityEntry,
  ActivityItem,
  ActivityParty,
  ActivityShare,
  ActivityTransfer,
} from './activity';
export type { Category } from './categories';
export type { Expense, ExpensePayer, ExpenseSplit, ExpenseWithParts } from './expenses';
export type { GroupSummary } from './groups';
export type { GroupBalances } from './ledger';
export type { User } from './profile';
export type { Group, Member } from './queries';
export type { TransferRow } from './transfers';
export { MAX_MEMBERS } from './validation';
export type {
  AddExpenseInput,
  AddTransferInput,
  CreateGroupInput,
  UpdateGroupInput,
} from './validation';
