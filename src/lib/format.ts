import { minorUnits, toDecimalString, type CurrencyCode, type Money } from '@/domain';

import { toUtcDate, type CalendarDate } from './calendar-date';

// Crear un formateador de Intl es costoso: se crea uno por idioma y moneda y se reutiliza.
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function moneyFormat(locale: string, currency: CurrencyCode): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let format = numberFormats.get(key);
  if (!format) {
    const digits = minorUnits(currency);
    format = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormats.set(key, format);
  }
  return format;
}

/**
 * Formatea un monto con `Intl.NumberFormat` según el idioma y los decimales de su moneda.
 * Solo para mostrar: el valor exacto sigue en unidades menores dentro de `Money`.
 */
export function formatMoney(value: Money, locale: string): string {
  return moneyFormat(locale, value.currency).format(Number(toDecimalString(value)));
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
