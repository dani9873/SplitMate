import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';

import { money, type Money } from '@/domain';

import { expenses, groupMembers, groups, transfers, users } from '../schema';
import { conflict, notFound, parse, ruleViolation } from './errors';
import { computeGroupBalances } from './ledger';
import { readLocalUser, type User } from './profile';
import { listMembers, requireGroup, type Group, type Member } from './queries';
import type { RepositoryContext } from './types';
import {
  createGroupSchema,
  createUserSchema,
  groupNameSchema,
  updateGroupSchema,
  type CreateGroupInput,
  type CreateUserInput,
  type UpdateGroupInput,
} from './validation';

export interface GroupSummary {
  readonly group: Group;
  readonly memberCount: number;
  /** Miembro vinculado al usuario local, o `null` si aún no se eligió. */
  readonly me: Member | null;
  /** Tu saldo en la moneda del grupo; `null` sin "yo". */
  readonly myBalance: Money | null;
  /** Último cambio del grupo o de sus movimientos, para ordenar la lista. */
  readonly lastActivityAt: number;
}

export function createUsersRepository(ctx: RepositoryContext) {
  const { db, deps } = ctx;
  return {
    create(input: CreateUserInput): User {
      const data = parse(createUserSchema, input);
      const now = deps.now();
      const user = db
        .insert(users)
        .values({
          id: deps.newId(),
          createdAt: now,
          updatedAt: now,
          displayName: data.displayName,
          email: data.email ?? null,
        })
        .returning()
        .get();
      ctx.notify(['users'], null);
      return user;
    },

    get(id: string): User | undefined {
      return db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .get();
    },
  };
}

export function createGroupsRepository(ctx: RepositoryContext) {
  const { db, deps } = ctx;

  /** Actualiza un grupo solo si su `version` sigue siendo la esperada. */
  function updateVersioned(
    id: string,
    expectedVersion: number,
    values: Partial<
      Pick<Group, 'name' | 'currency' | 'emoji' | 'color' | 'archivedAt' | 'deletedAt'>
    >,
  ): Group {
    const [updated] = db
      .update(groups)
      .set({ ...values, updatedAt: deps.now(), version: sql`${groups.version} + 1` })
      .where(and(eq(groups.id, id), eq(groups.version, expectedVersion), isNull(groups.deletedAt)))
      .returning()
      .all();
    if (!updated) {
      requireGroup(db, id);
      throw conflict('El grupo');
    }
    ctx.notify(['groups'], [id]);
    return updated;
  }

  function requireUnarchived(id: string): Group {
    const group = requireGroup(db, id);
    if (group.archivedAt !== null) {
      throw ruleViolation('GROUP_ARCHIVED', 'El grupo está archivado: es de solo lectura');
    }
    return group;
  }

  function hasMovements(groupId: string): boolean {
    const expense = db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
      .limit(1)
      .get();
    if (expense) {
      return true;
    }
    return (
      db
        .select({ id: transfers.id })
        .from(transfers)
        .where(and(eq(transfers.groupId, groupId), isNull(transfers.deletedAt)))
        .limit(1)
        .get() !== undefined
    );
  }

  /** Último instante en que cambió algo del grupo o de sus movimientos. */
  function lastActivityAt(group: Group): number {
    const latestExpense = db
      .select({ at: max(expenses.updatedAt) })
      .from(expenses)
      .where(eq(expenses.groupId, group.id))
      .get()?.at;
    const latestTransfer = db
      .select({ at: max(transfers.updatedAt) })
      .from(transfers)
      .where(eq(transfers.groupId, group.id))
      .get()?.at;
    return Math.max(group.updatedAt, latestExpense ?? 0, latestTransfer ?? 0);
  }

  /** Grupos activos, los modificados más recientemente primero. */
  function list(): Group[] {
    return db
      .select()
      .from(groups)
      .where(isNull(groups.deletedAt))
      .orderBy(desc(groups.updatedAt), desc(groups.id))
      .all();
  }

  return {
    /** Crea el grupo y sus miembros en una transacción. El primer miembro es el dueño. */
    create(input: CreateGroupInput): Group {
      const data = parse(createGroupSchema, input);
      const creator = db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, data.createdBy), isNull(users.deletedAt)))
        .get();
      if (!creator) {
        throw notFound('El usuario creador');
      }
      const group = db.transaction((tx) => {
        const now = deps.now();
        const created = tx
          .insert(groups)
          .values({
            id: deps.newId(),
            createdAt: now,
            updatedAt: now,
            name: data.name,
            currency: data.currency,
            emoji: data.emoji ?? null,
            color: data.color,
            createdBy: data.createdBy,
          })
          .returning()
          .get();
        data.members.forEach((member, index) => {
          tx.insert(groupMembers)
            .values({
              id: deps.newId(),
              createdAt: now,
              updatedAt: now,
              groupId: created.id,
              userId: member.userId ?? null,
              displayName: member.displayName,
              role: index === 0 ? 'owner' : 'member',
            })
            .run();
        });
        return created;
      });
      ctx.notify(['groups', 'group_members'], [group.id]);
      return group;
    },

    list,

    get(id: string): Group | undefined {
      return db
        .select()
        .from(groups)
        .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
        .get();
    },

    /**
     * Grupos con su número de miembros y tu saldo. Primero los activos y al final los
     * archivados, cada parte ordenada por la actividad más reciente.
     */
    listSummaries(): GroupSummary[] {
      const localUser = readLocalUser(db);
      const summaries = list().map((group) => {
        const members = listMembers(db, group.id);
        const me = (localUser && members.find((m) => m.userId === localUser.id)) || null;
        const balance = me
          ? computeGroupBalances(db, group).balances.find((b) => b.memberId === me.id)
          : undefined;
        return {
          group,
          memberCount: members.length,
          me,
          myBalance: me ? (balance?.amount ?? money(0, group.currency)) : null,
          lastActivityAt: lastActivityAt(group),
        };
      });
      return summaries.sort(
        (a, b) =>
          Number(a.group.archivedAt !== null) - Number(b.group.archivedAt !== null) ||
          b.lastActivityAt - a.lastActivityAt ||
          (a.group.id < b.group.id ? 1 : -1),
      );
    },

    rename(id: string, expectedVersion: number, name: string): Group {
      requireUnarchived(id);
      return updateVersioned(id, expectedVersion, { name: parse(groupNameSchema, name) });
    },

    /** Edita nombre, emoji, color y moneda. La moneda solo cambia sin movimientos. */
    update(id: string, expectedVersion: number, input: UpdateGroupInput): Group {
      const data = parse(updateGroupSchema, input);
      const group = requireUnarchived(id);
      if (data.currency !== group.currency && hasMovements(id)) {
        throw ruleViolation(
          'CURRENCY_LOCKED',
          'La moneda del grupo no cambia cuando ya tiene movimientos',
        );
      }
      return updateVersioned(id, expectedVersion, {
        name: data.name,
        currency: data.currency,
        emoji: data.emoji,
        color: data.color,
      });
    },

    /** Deja el grupo en solo lectura y fuera de la lista activa. */
    archive(id: string, expectedVersion: number): Group {
      requireUnarchived(id);
      return updateVersioned(id, expectedVersion, { archivedAt: deps.now() });
    },

    /** Devuelve el grupo archivado a la lista activa. */
    unarchive(id: string, expectedVersion: number): Group {
      return updateVersioned(id, expectedVersion, { archivedAt: null });
    },

    /** Borrado lógico: el grupo deja de aparecer, pero se conserva para sincronizar. */
    remove(id: string, expectedVersion: number): void {
      updateVersioned(id, expectedVersion, { deletedAt: deps.now() });
    },
  };
}
