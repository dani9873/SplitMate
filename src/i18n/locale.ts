/** Lo que se necesita de cada locale del dispositivo para formatear. */
export interface DeviceFormattingLocale {
  languageTag: string;
  languageCode: string | null;
}

/**
 * Locale para `Intl`: el idioma de la app con la región del dispositivo cuando coinciden.
 * Con la app en español en un teléfono es-CO, los montos salen como en Colombia; con la app
 * en inglés en ese mismo teléfono, sale `en`.
 */
export function resolveFormattingLocale(
  language: string,
  locales: readonly DeviceFormattingLocale[],
): string {
  const match = locales.find((locale) => locale.languageCode?.toLowerCase() === language);
  return match?.languageTag ?? language;
}

// Regiones donde la semana del calendario empieza en domingo. En el resto, en lunes.
const SUNDAY_FIRST = new Set([
  'US',
  'CA',
  'MX',
  'BR',
  'CO',
  'PE',
  'VE',
  'GT',
  'SV',
  'HN',
  'NI',
  'PA',
  'DO',
  'PR',
  'JP',
  'IL',
  'PH',
]);

/** Primer día de la semana para el calendario: 0 domingo, 1 lunes. */
export function weekStartsOn(locale: string): 0 | 1 {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  if (region) {
    return SUNDAY_FIRST.has(region) ? 0 : 1;
  }
  return locale.toLowerCase().startsWith('en') ? 0 : 1;
}
