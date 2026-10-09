import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { LanguagePreference } from '@/i18n';
import { logger } from '@/lib/logger';

import { applyLanguagePreference, applyThemePreference } from './apply-preferences';
import {
  defaultPreferences,
  parseStoredPreferences,
  type StoredPreferences,
  type ThemePreference,
} from './preferences';

export interface PreferencesState extends StoredPreferences {
  /** Ya se leyó lo guardado, o la lectura falló y se usan valores por defecto. */
  hydrated: boolean;
  setLanguage: (language: LanguagePreference) => void;
  setTheme: (theme: ThemePreference) => void;
}

export const PREFERENCES_STORAGE_KEY = 'splitmate.preferences';

let markHydrated: () => void = () => {};

/**
 * Preferencias de interfaz del usuario: idioma y tema. Es estado de UI, así que vive en
 * Zustand y se guarda en AsyncStorage. No contiene datos sensibles.
 */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => {
      markHydrated = () => set({ hydrated: true });
      return {
        ...defaultPreferences,
        hydrated: false,
        setLanguage: (language) => {
          set({ language });
          applyLanguagePreference(language);
        },
        setTheme: (theme) => {
          set({ theme });
          applyThemePreference(theme);
        },
      };
    },
    {
      name: PREFERENCES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ language, theme }) => ({ language, theme }),
      merge: (persisted, current) => ({ ...current, ...parseStoredPreferences(persisted) }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          logger.warn('No se pudieron leer las preferencias; se usan las predeterminadas.', error);
        }
        // Se aplican antes de marcar la hidratación: la primera pantalla ya sale con el
        // idioma y el tema correctos, sin parpadeos.
        const { language, theme } = state ?? defaultPreferences;
        applyLanguagePreference(language);
        applyThemePreference(theme);
        markHydrated();
      },
    },
  ),
);
