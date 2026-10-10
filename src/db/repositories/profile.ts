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
 * Toma como usuario local a un usuario ya creado en este dispositivo, si sigue activo. Sirve
 * para datos anteriores al perfil local, donde un miembro ya apunta a ese usuario. No emite.
 */
export function adoptLocalUser(ctx: RepositoryContext, userId: string): User | null {
  const user = ctx.db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .get();
  if (!user) {
    return null;
  }
  writeSetting(ctx.db, SETTING_KEYS.localUserId, user.id, ctx.deps.now());
  return user;
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
