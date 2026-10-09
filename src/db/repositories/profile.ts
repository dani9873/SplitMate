import { and, eq, isNull } from 'drizzle-orm';

import { users } from '../schema';
import { parse } from './errors';
import { readSetting, SETTING_KEYS, writeSetting } from './local-settings';
import type { AppDatabase, RepositoryContext } from './types';
import { displayNameSchema } from './validation';

export type User = typeof users.$inferSelect;

/** Usuario local de este dispositivo, o `null` si todavía no se creó. */
export function readLocalUser(db: AppDatabase): User | null {
  const id = readSetting(db, SETTING_KEYS.localUserId);
  if (!id) {
    return null;
  }
  return (
    db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .get() ?? null
  );
}

/**
 * Crea el usuario local si no existe y devuelve el de siempre si ya existe. No emite: quien
 * lo llama avisa con las tablas que también escribió.
 */
export function ensureLocalUser(ctx: RepositoryContext, displayName: string): User {
  const name = parse(displayNameSchema, displayName);
  const existing = readLocalUser(ctx.db);
  if (existing) {
    return existing;
  }
  return ctx.db.transaction((tx) => {
    const now = ctx.deps.now();
    const user = tx
      .insert(users)
      .values({ id: ctx.deps.newId(), createdAt: now, updatedAt: now, displayName: name })
      .returning()
      .get();
    writeSetting(tx, SETTING_KEYS.localUserId, user.id, now);
    return user;
  });
}

/**
 * Usuario de este dispositivo. Hasta que exista el login, "yo" en un grupo es el miembro
 * vinculado a este usuario. Con el login, la cuenta se asociará a este mismo usuario.
 */
export function createProfileRepository(ctx: RepositoryContext) {
  return {
    get(): User | null {
      return readLocalUser(ctx.db);
    },

    /** Crea el usuario local la primera vez; después devuelve siempre el mismo. */
    ensure(displayName: string): User {
      const existing = readLocalUser(ctx.db);
      if (existing) {
        parse(displayNameSchema, displayName);
        return existing;
      }
      const user = ensureLocalUser(ctx, displayName);
      ctx.notify(['users'], null);
      return user;
    },
  };
}
