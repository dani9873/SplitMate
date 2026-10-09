import { and, asc, isNull } from 'drizzle-orm';

import { categories } from '../schema';
import type { RepositoryContext } from './types';

export type Category = typeof categories.$inferSelect;

export function createCategoriesRepository(ctx: RepositoryContext) {
  return {
    /**
     * Categorías predefinidas en su orden fijo, que es el de sus ids. El nombre visible sale
     * de la traducción `categories.<key>`.
     */
    list(): Category[] {
      return ctx.db
        .select()
        .from(categories)
        .where(and(isNull(categories.groupId), isNull(categories.deletedAt)))
        .orderBy(asc(categories.id))
        .all();
    },
  };
}
