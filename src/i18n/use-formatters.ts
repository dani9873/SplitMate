import { useLocales } from 'expo-localization';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Money } from '@/domain';
import type { CalendarDate } from '@/lib/calendar-date';
import {
  decimalSeparator,
  formatDay,
  formatInstant,
  formatMoney,
  type DayStyle,
} from '@/lib/format';

import { resolveFormattingLocale, weekStartsOn } from './locale';

export interface Formatters {
  readonly locale: string;
  readonly decimalSeparator: string;
  readonly weekStartsOn: 0 | 1;
  money(value: Money): string;
  day(value: CalendarDate, style: DayStyle): string;
  /** Fecha y hora de un instante, por ejemplo la última sincronización. */
  instant(value: number): string;
}

/** Formateadores de montos y fechas con el idioma de la app y la región del dispositivo. */
export function useFormatters(): Formatters {
  const { i18n } = useTranslation();
  const deviceLocales = useLocales();
  const locale = resolveFormattingLocale(i18n.language, deviceLocales);
  return useMemo(
    () => ({
      locale,
      decimalSeparator: decimalSeparator(locale),
      weekStartsOn: weekStartsOn(locale),
      money: (value: Money) => formatMoney(value, locale),
      day: (value: CalendarDate, style: DayStyle) => formatDay(value, locale, style),
      instant: (value: number) => formatInstant(value, locale),
    }),
    [locale],
  );
}
