import { colorScheme } from 'nativewind';

import {
  changeLanguage,
  resolveLanguage,
  type DeviceLocale,
  type LanguagePreference,
} from '@/i18n';

import type { ThemePreference } from './preferences';

/** Cambia el idioma de la app al instante. Con "system" sigue al dispositivo. */
export function applyLanguagePreference(
  preference: LanguagePreference,
  locales?: readonly DeviceLocale[],
): void {
  void changeLanguage(resolveLanguage(preference, locales));
}

/**
 * Cambia el tema al instante. NativeWind actualiza las clases y el `Appearance` nativo,
 * así que teclado, diálogos y barra de estado también siguen la elección.
 */
export function applyThemePreference(preference: ThemePreference): void {
  colorScheme.set(preference);
}
