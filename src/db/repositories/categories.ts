import { and, asc, isNull } from 'drizzle-orm';

import { categories } from '../schema';
import type { RepositoryContext } from './types';

export type Category = typeof categories.$inferSelect;

/**
 * Id fijo de la categoría predefinida "Otros" (clave `other`, migración 0001). Un gasto o
 * ingreso sin categoría elegida se guarda con ella.
 */
export const OTHER_CATEGORY_ID = '0199c82c-c000-7000-8000-000000000009';

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
