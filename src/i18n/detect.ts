import { getLocales } from 'expo-localization';

import { fallbackLanguage, isSupportedLanguage, type LanguageCode } from './languages';

/** Preferencia guardada por el usuario: un idioma concreto o seguir al dispositivo. */
export type LanguagePreference = 'system' | LanguageCode;

/** Lo único que necesitamos de cada locale del dispositivo. */
export interface DeviceLocale {
  languageCode: string | null;
}

/**
 * Devuelve el primer idioma de la lista de preferencias del dispositivo que la app
 * soporta. Si ninguno está disponible, usa el idioma de respaldo.
 */
export function detectDeviceLanguage(
  locales: readonly DeviceLocale[] = getLocales(),
): LanguageCode {
  for (const { languageCode } of locales) {
    const code = languageCode?.toLowerCase();
    if (code && isSupportedLanguage(code)) {
      return code;
    }
  }
  return fallbackLanguage;
}

/** Convierte la preferencia del usuario en el idioma que debe mostrarse. */
export function resolveLanguage(
  preference: LanguagePreference,
  locales?: readonly DeviceLocale[],
): LanguageCode {
  return preference === 'system' ? detectDeviceLanguage(locales) : preference;
}
