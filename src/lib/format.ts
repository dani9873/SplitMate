import { minorUnits, toDecimalString, type CurrencyCode, type Money } from '@/domain';

import { toUtcDate, type CalendarDate } from './calendar-date';

// Crear un formateador de Intl es costoso: se crea uno por idioma y moneda y se reutiliza.
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const currencySymbols = new Map<CurrencyCode, string>();

// El símbolo sale siempre del mismo locale: así "GTQ" o "$" se escriben igual en todos los idiomas
// y regiones, y no hay que fiarse de la tabla de cada teléfono.
const SYMBOL_LOCALE = 'en-US';

// Un símbolo que termina en un signo de moneda ($, €, ¥, MX$...) va pegado a la cifra; uno que
// termina en letras (GTQ, KWD) lleva un espacio.
const CURRENCY_SIGN_END = /[$\u00a2-\u00a5\u20a0-\u20cf]$/;
const NO_BREAK_SPACE = '\u00a0';

function digitsFormat(locale: string, currency: CurrencyCode): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let format = numberFormats.get(key);
  if (!format) {
    const digits = minorUnits(currency);
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(key, format);
  }
  return format;
}

function currencySymbol(currency: CurrencyCode): string {
  let symbol = currencySymbols.get(currency);
  if (symbol === undefined) {
    symbol =
      new Intl.NumberFormat(SYMBOL_LOCALE, { style: 'currency', currency })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency;
    currencySymbols.set(currency, symbol);
  }
  return symbol;
}

/**
 * Formatea un monto: el signo, el símbolo de la moneda siempre antes de la cifra (con un espacio
 * si es un código de letras, como "GTQ 1.00"; pegado en "$1.00") y la cifra con los decimales de su
 * moneda y los separadores del idioma. La posición y el espacio del símbolo los fijamos aquí porque
 * `Intl` los decide por región y por los datos de cada teléfono (Samsung dio "GTQ1.00" y Poco
 * "1.00 GTQ"). Solo para mostrar: el valor exacto sigue en unidades menores dentro de `Money`.
 */
export function formatMoney(value: Money, locale: string): string {
  const text = toDecimalString(value);
  const negative = text.startsWith('-');
  const digits = digitsFormat(locale, value.currency).format(
    Number(negative ? text.slice(1) : text),
  );
  const symbol = currencySymbol(value.currency);
  const gap = CURRENCY_SIGN_END.test(symbol) ? '' : NO_BREAK_SPACE;
  return `${negative ? '-' : ''}${symbol}${gap}${digits}`;
}

/** Separador decimal del idioma: `,` en es-CO, `.` en en-US. */
export function decimalSeparator(locale: string): string {
  const sample = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).format(1.5);
  return sample.replace(/\d/g, '').charAt(0) || '.';
}

export type DayStyle = 'long' | 'medium' | 'weekday';

const DAY_OPTIONS: Record<DayStyle, Intl.DateTimeFormatOptions> = {
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  weekday: { weekday: 'long', day: 'numeric', month: 'long' },
};

const INSTANT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/** Formatea un instante (milisegundos desde 1970) en la zona horaria del teléfono. */
export function formatInstant(value: number, locale: string): string {
  const key = `${locale}|instant`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, INSTANT_OPTIONS);
    dateFormats.set(key, format);
  }
  return format.format(new Date(value));
}

/** Formatea un día de calendario sin que la zona horaria lo corra. */
export function formatDay(value: CalendarDate, locale: string, style: DayStyle): string {
  const key = `${locale}|${style}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { ...DAY_OPTIONS[style], timeZone: 'UTC' });
    dateFormats.set(key, format);
  }
  return format.format(toUtcDate(value));
}
