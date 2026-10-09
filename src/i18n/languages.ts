import en from './locales/en.json';
import es from './locales/es.json';

/** Estructura que debe cumplir cada archivo de idioma; `en.json` es la referencia. */
export type TranslationResource = typeof en;

/**
 * Registro de idiomas disponibles.
 *
 * Para agregar uno: copia `locales/en.json` como `locales/<código>.json`, tradúcelo,
 * impórtalo arriba y agrégalo aquí. `satisfies` hace que TypeScript marque cualquier
 * clave faltante. Más detalles en `src/i18n/README.md`.
 */
export const languages = {
  es,
  en,
} satisfies Record<string, TranslationResource>;

export type LanguageCode = keyof typeof languages;

/** Idioma usado cuando el del dispositivo no está disponible. */
export const fallbackLanguage: LanguageCode = 'en';

export const supportedLanguages = Object.keys(languages) as LanguageCode[];

export function isSupportedLanguage(code: string): code is LanguageCode {
  return Object.prototype.hasOwnProperty.call(languages, code);
}

/** Nombre del idioma escrito en ese mismo idioma, por ejemplo "Español". */
export function getNativeName(code: LanguageCode): string {
  return languages[code].meta.nativeName;
}
