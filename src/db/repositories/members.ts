import { and, eq, isNull, sql } from 'drizzle-orm';

import { groupMembers } from '../schema';
import { conflict, invalid, notFound, parse, ruleViolation } from './errors';
import { computeGroupBalances } from './ledger';
import { ensureLocalUser, readLocalUser } from './profile';
import { listAllMembers, listMembers, requireWritableGroup, type Member } from './queries';
import type { RepositoryContext } from './types';
import { displayNameSchema, MAX_MEMBERS } from './validation';

export function createMembersRepository(ctx: RepositoryContext) {
  const { db, deps } = ctx;

  function requireMember(id: string): Member {
    const member = db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.id, id), isNull(groupMembers.deletedAt)))
      .get();
    if (!member) {
      throw notFound('El miembro');
    }
    return member;
  }

  function updateVersioned(
    member: Member,
    expectedVersion: number,
    values: Partial<Pick<Member, 'displayName' | 'deletedAt'>>,
  ): Member {
    const [updated] = db
      .update(groupMembers)
      .set({ ...values, updatedAt: deps.now(), version: sql`${groupMembers.version} + 1` })
      .where(
        and(
          eq(groupMembers.id, member.id),
          eq(groupMembers.version, expectedVersion),
          isNull(groupMembers.deletedAt),
        ),
      )
      .returning()
      .all();
    if (!updated) {
      throw conflict('El miembro');
    }
    ctx.notify(['group_members'], [member.groupId]);
    return updated;
  }

  return {
    /** Miembros activos en orden de creación. */
    listByGroup(groupId: string): Member[] {
      return listMembers(db, groupId);
    },

    /** Miembros activos vinculados al usuario local: "yo" en cada grupo. */
    listMine(): Member[] {
      const user = readLocalUser(db);
      if (!user) {
        return [];
      }
      return db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.userId, user.id), isNull(groupMembers.deletedAt)))
        .all();
    },

    /** Todos los miembros, incluidos los quitados, para nombrarlos en el historial. */
    listAll(groupId: string): Member[] {
      return listAllMembers(db, groupId);
    },

    add(groupId: string, displayName: string): Member {
      const name = parse(displayNameSchema, displayName);
      const group = requireWritableGroup(db, groupId);
      if (listMembers(db, group.id).length >= MAX_MEMBERS) {
        throw invalid(`Un grupo tiene como máximo ${MAX_MEMBERS} miembros`);
      }
      const now = deps.now();
      const member = db
        .insert(groupMembers)
        .values({
          id: deps.newId(),
          createdAt: now,
          updatedAt: now,
          groupId: group.id,
          displayName: name,
        })
        .returning()
        .get();
      ctx.notify(['group_members'], [group.id]);
      return member;
    },

    rename(id: string, expectedVersion: number, displayName: string): Member {
      const name = parse(displayNameSchema, displayName);
      const member = requireMember(id);
      requireWritableGroup(db, member.groupId);
      return updateVersioned(member, expectedVersion, { displayName: name });
    },

    /**
     * Quita al miembro con borrado lógico. Solo si su saldo es cero y no es el último: así
     * nadie desaparece debiendo o con dinero a favor, y el grupo nunca queda vacío.
     */
    remove(id: string, expectedVersion: number): void {
      const member = requireMember(id);
      const group = requireWritableGroup(db, member.groupId);
      if (listMembers(db, group.id).length <= 1) {
        throw ruleViolation('LAST_MEMBER', 'Un grupo necesita al menos un miembro');
      }
      const balance = computeGroupBalances(db, group).balances.find((b) => b.memberId === id);
      if (balance && balance.amount.amount !== 0) {
        throw ruleViolation('MEMBER_HAS_BALANCE', 'El miembro tiene saldo pendiente', {
          balance: balance.amount,
        });
      }
      updateVersioned(member, expectedVersion, { deletedAt: deps.now() });
    },

    /**
     * Elige qué miembro del grupo es "yo": lo vincula al usuario local y desvincula al
     * anterior, en una transacción. Con `null`, el grupo queda sin "yo". Si el usuario local
     * aún no existe, se crea con el nombre del miembro elegido.
     */
    setCurrentMember(groupId: string, memberId: string | null): void {
      const group = requireWritableGroup(db, groupId);
      const target = memberId === null ? null : requireMember(memberId);
      if (target && target.groupId !== group.id) {
        throw notFound('El miembro');
      }
      if (target?.userId && target.userId !== readLocalUser(db)?.id) {
        throw invalid('El miembro ya está vinculado a otra persona');
      }
      const user = target ? ensureLocalUser(ctx, target.displayName) : readLocalUser(db);
      if (!user) {
        return;
      }
      db.transaction((tx) => {
        const now = deps.now();
        const bump = { updatedAt: now, version: sql`${groupMembers.version} + 1` };
        tx.update(groupMembers)
          .set({ ...bump, userId: null })
          .where(
            and(
              eq(groupMembers.groupId, group.id),
              eq(groupMembers.userId, user.id),
              isNull(groupMembers.deletedAt),
            ),
          )
          .run();
        if (target) {
          tx.update(groupMembers)
            .set({ ...bump, userId: user.id })
            .where(eq(groupMembers.id, target.id))
            .run();
        }
      });
      ctx.notify(['users', 'group_members'], [group.id]);
    },
  };
}
