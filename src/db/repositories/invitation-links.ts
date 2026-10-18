import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { invitationLinks } from '../schema';
import { parse } from './errors';
import type { RepositoryContext } from './types';

export type InvitationLink = typeof invitationLinks.$inferSelect;

const saveSchema = z.object({
  id: z.guid(),
  groupId: z.string().min(1).max(64),
  /** El servidor solo guarda el hash: este es el único lugar donde el token se puede volver a ver. */
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.int().positive(),
  maxUses: z.int().min(1).max(50),
});

export type SaveInvitationLinkInput = z.input<typeof saveSchema>;

/**
 * Los enlaces de invitación que creó este teléfono, con su token, para «Compartir de nuevo». Viven
 * en la base cifrada, no se sincronizan y los demás teléfonos de la cuenta no los ven.
 */
export function createInvitationLinksRepository(ctx: RepositoryContext) {
  const { db, deps } = ctx;

  return {
    /** Guarda el enlace recién creado (o reemplaza el del mismo id). */
    save(input: SaveInvitationLinkInput): InvitationLink {
      const data = parse(saveSchema, input);
      return db
        .insert(invitationLinks)
        .values({ ...data, createdAt: deps.now() })
        .onConflictDoUpdate({
          target: invitationLinks.id,
          set: { token: data.token, expiresAt: data.expiresAt, maxUses: data.maxUses },
        })
        .returning()
        .get();
    },

    get(id: string): InvitationLink | undefined {
      return db.select().from(invitationLinks).where(eq(invitationLinks.id, id)).get();
    },

    /** Los de un grupo, del más nuevo al más viejo. */
    listByGroup(groupId: string): InvitationLink[] {
      return db
        .select()
        .from(invitationLinks)
        .where(eq(invitationLinks.groupId, groupId))
        .orderBy(desc(invitationLinks.createdAt), desc(invitationLinks.id))
        .all();
    },

    remove(id: string): void {
      db.delete(invitationLinks).where(eq(invitationLinks.id, id)).run();
    },
  };
}
