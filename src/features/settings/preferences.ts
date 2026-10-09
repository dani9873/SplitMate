import { z } from 'zod';

import { isSupportedLanguage, type LanguagePreference } from '@/i18n';

export const themePreferences = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof themePreferences)[number];

const languagePreferenceSchema = z.custom<LanguagePreference>(
  (value) => value === 'system' || (typeof value === 'string' && isSupportedLanguage(value)),
);

/**
 * Lo que se guarda en el dispositivo. Se valida al leerlo: un valor desconocido
 * (por ejemplo, un idioma que se quitó) vuelve a "seguir al sistema".
 */
export const storedPreferencesSchema = z.object({
  language: languagePreferenceSchema.catch('system'),
  theme: z.enum(themePreferences).catch('system'),
});

export type StoredPreferences = z.infer<typeof storedPreferencesSchema>;

export const defaultPreferences: StoredPreferences = { language: 'system', theme: 'system' };

export function parseStoredPreferences(value: unknown): StoredPreferences {
  const result = storedPreferencesSchema.safeParse(value ?? {});
  return result.success ? result.data : defaultPreferences;
}
