import { minorUnits, toDecimalString, type Money } from '@/domain';

/**
 * Formatea un monto con `Intl.NumberFormat` según el idioma y los decimales de su moneda.
 * Solo para mostrar: el valor exacto sigue en unidades menores dentro de `Money`.
 */
export function formatMoney(value: Money, locale: string): string {
  const digits = minorUnits(value.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(toDecimalString(value)));
}
