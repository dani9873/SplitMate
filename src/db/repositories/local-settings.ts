import { eq } from 'drizzle-orm';

import { localSettings } from '../schema';
import type { AppDatabase } from './types';

/**
 * Ajustes de este dispositivo en `local_settings`. No se sincronizan ni avisan en el bus de
 * cambios: ninguna pantalla los lista.
 */
export const SETTING_KEYS = {
  localUserId: 'profile.userId',
  entryDraft: (groupId: string) => `draft.entry.${groupId}`,
} as const;

export function readSetting(db: AppDatabase, key: string): string | null {
  return (
    db
      .select({ value: localSettings.value })
      .from(localSettings)
      .where(eq(localSettings.key, key))
      .get()?.value ?? null
  );
}

export function writeSetting(db: AppDatabase, key: string, value: string, now: number): void {
  db.insert(localSettings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: localSettings.key, set: { value, updatedAt: now } })
    .run();
}

export function deleteSetting(db: AppDatabase, key: string): void {
  db.delete(localSettings).where(eq(localSettings.key, key)).run();
}
