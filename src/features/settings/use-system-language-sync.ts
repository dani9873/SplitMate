import { useLocales } from 'expo-localization';
import { useEffect } from 'react';

import { applyLanguagePreference } from './apply-preferences';
import { usePreferences } from './preferences-store';

/**
 * Si el usuario eligió "idioma del dispositivo", vuelve a aplicarlo cuando cambia la
 * configuración del teléfono mientras la app está abierta.
 */
export function useSystemLanguageSync(): void {
  const locales = useLocales();
  const language = usePreferences((state) => state.language);
  const hydrated = usePreferences((state) => state.hydrated);

  useEffect(() => {
    if (hydrated && language === 'system') {
      applyLanguagePreference('system', locales);
    }
  }, [hydrated, language, locales]);
}
