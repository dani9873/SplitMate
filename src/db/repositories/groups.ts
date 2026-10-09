import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { groupMembers, groups, users } from '../schema';
import { conflict, notFound, parse } from './errors';
import type { AppDatabase, RepositoryDeps } from './types';
import {
  createGroupSchema,
  createUserSchema,
  groupNameSchema,
  type CreateGroupInput,
  type CreateUserInput,
} from './validation';

export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Member = typeof groupMembers.$inferSelect;

export function createUsersRepository(db: AppDatabase, deps: RepositoryDeps) {
  return {
    create(input: CreateUserInput): User {
      const data = parse(createUserSchema, input);
      const now = deps.now();
      return db
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

/** Grupo activo o `NOT_FOUND`. Compartido por los demás repositorios. */
export function requireGroup(db: AppDatabase, id: string): Group {
  const group = db
    .select()
    .from(groups)
    .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
    .get();
  if (!group) {
    throw notFound('El grupo');
  }
  return group;
}

/** Miembros activos de un grupo en orden de creación, que es el orden de sus UUID v7. */
export function listMembers(db: AppDatabase, groupId: string): Member[] {
  return db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.deletedAt)))
    .orderBy(asc(groupMembers.id))
    .all();
}

export function createGroupsRepository(db: AppDatabase, deps: RepositoryDeps) {
  /** Actualiza un grupo solo si su `version` sigue siendo la esperada. */
  function updateVersioned(
    id: string,
    expectedVersion: number,
    values: Partial<Pick<Group, 'name' | 'deletedAt'>>,
  ): Group {
    const [updated] = db
      .update(groups)
      .set({ ...values, updatedAt: deps.now(), version: sql`${groups.version} + 1` })
      .where(and(eq(groups.id, id), eq(groups.version, expectedVersion), isNull(groups.deletedAt)))
      .returning()
      .all();
    if (updated) {
      return updated;
    }
    requireGroup(db, id);
    throw conflict('El grupo');
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
      return db.transaction((tx) => {
        const now = deps.now();
        const group = tx
          .insert(groups)
          .values({
            id: deps.newId(),
            createdAt: now,
            updatedAt: now,
            name: data.name,
            currency: data.currency,
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
              groupId: group.id,
              userId: member.userId ?? null,
              displayName: member.displayName,
              role: index === 0 ? 'owner' : 'member',
            })
            .run();
        });
        return group;
      });
    },

    /** Grupos activos, los modificados más recientemente primero. */
    list(): Group[] {
      return db
        .select()
        .from(groups)
        .where(isNull(groups.deletedAt))
        .orderBy(desc(groups.updatedAt), desc(groups.id))
        .all();
    },

    get(id: string): Group | undefined {
      return db
        .select()
        .from(groups)
        .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
        .get();
    },

    rename(id: string, expectedVersion: number, name: string): Group {
      return updateVersioned(id, expectedVersion, { name: parse(groupNameSchema, name) });
    },

    /** Borrado lógico: el grupo deja de aparecer, pero se conserva para sincronizar. */
    remove(id: string, expectedVersion: number): void {
      updateVersioned(id, expectedVersion, { deletedAt: deps.now() });
    },
  };
}

export function createMembersRepository(db: AppDatabase) {
  return {
    listByGroup(groupId: string): Member[] {
      return listMembers(db, groupId);
    },
  };
}
