import type { z } from 'zod';

import { invalid } from './errors';
import { deleteSetting, readSetting, SETTING_KEYS, writeSetting } from './local-settings';
import type { RepositoryContext } from './types';

/** Caracteres máximos de un borrador serializado. Un formulario lleno ocupa unos pocos miles. */
export const MAX_DRAFT_LENGTH = 16_384;

/**
 * Borradores del formulario de nuevo movimiento, uno por grupo, en la base cifrada. No se
 * sincronizan ni avisan cambios. El formulario define su forma con un esquema zod versionado.
 */
export function createDraftsRepository(ctx: RepositoryContext) {
  const { db, deps } = ctx;

  return {
    /** Borrador del grupo validado con `schema`. Si ya no lo cumple, se borra y da `null`. */
    get<T>(groupId: string, schema: z.ZodType<T>): T | null {
      const key = SETTING_KEYS.entryDraft(groupId);
      const stored = readSetting(db, key);
      if (stored === null) {
        return null;
      }
      let value: unknown;
      try {
        value = JSON.parse(stored);
      } catch {
        value = undefined;
      }
      const result = schema.safeParse(value);
      if (!result.success) {
        deleteSetting(db, key);
        return null;
      }
      return result.data;
    },

    save(groupId: string, draft: unknown): void {
      const serialized = JSON.stringify(draft);
      if (serialized.length > MAX_DRAFT_LENGTH) {
        throw invalid('El borrador es demasiado grande');
      }
      writeSetting(db, SETTING_KEYS.entryDraft(groupId), serialized, deps.now());
    },

    discard(groupId: string): void {
      deleteSetting(db, SETTING_KEYS.entryDraft(groupId));
    },
  };
}
