/** Lo que se necesita de cada locale del dispositivo para elegir el calendario. */
export interface DeviceFormattingLocale {
  languageTag: string;
  languageCode: string | null;
}

// Convención de números y fechas de cada idioma de la app. Sin región del teléfono: el mismo
// idioma se ve igual en todos los dispositivos (la región y los datos de ICU cambian de un
// fabricante a otro). Español latinoamericano: punto decimal y coma de miles.
const FORMAT_LOCALES: Readonly<Record<string, string>> = {
  es: 'es-419',
  en: 'en-US',
};

/** Locale para `Intl` según el idioma de la app. Un idioma sin convención propia se usa tal cual. */
export function resolveFormattingLocale(language: string): string {
  return FORMAT_LOCALES[language] ?? language;
}

/**
 * Locale del calendario: el idioma de la app con la región del dispositivo cuando coinciden. Solo
 * sirve para el primer día de la semana (`weekStartsOn`), que sí depende de la región.
 */
export function resolveCalendarLocale(
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
