import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import {
  addDays,
  formatCalendarDate,
  fromParts,
  monthGrid,
  parseCalendarDate,
  type CalendarDate,
} from '@/lib/calendar-date';
import { formatDay } from '@/lib/format';

import { cn } from './cn';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface CalendarProps {
  value: CalendarDate;
  onChange: (date: CalendarDate) => void;
  /** Hoy, en hora local; se marca en la cuadrícula. */
  today: CalendarDate;
  locale: string;
  weekStartsOn: 0 | 1;
}

// 4 de octubre de 2026 fue domingo: sirve para nombrar los días de la semana con Intl.
const KNOWN_SUNDAY = '2026-10-04';

/**
 * Calendario mensual propio, en JS: cada día es un botón de 44 px que el lector de pantalla
 * lee con la fecha completa. No depende de un selector nativo.
 */
export function Calendar({ value, onChange, today, locale, weekStartsOn }: CalendarProps) {
  const { t } = useTranslation();
  const initial = parseCalendarDate(value);
  const [visible, setVisible] = useState({ year: initial.year, month: initial.month });

  const weeks = useMemo(
    () => monthGrid(visible.year, visible.month, weekStartsOn),
    [visible, weekStartsOn],
  );
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const day = addDays(KNOWN_SUNDAY, (index + weekStartsOn) % 7);
        return {
          short: formatCalendarDate(day, locale, { weekday: 'narrow' }),
          long: formatCalendarDate(day, locale, { weekday: 'long' }),
        };
      }),
    [locale, weekStartsOn],
  );
  const title = formatCalendarDate(fromParts(visible.year, visible.month, 1), locale, {
    month: 'long',
    year: 'numeric',
  });

  const shiftMonth = (delta: number) =>
    setVisible(({ year, month }) => {
      const index = year * 12 + (month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });

  return (
    <View className="gap-2 px-3">
      <View className="flex-row items-center">
        <IconButton
          icon={ChevronLeft}
          label={t('ui.calendar.previousMonth')}
          onPress={() => shiftMonth(-1)}
        />
        <Text
          variant="subheading"
          className="flex-1 text-center capitalize"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
        >
          {title}
        </Text>
        <IconButton
          icon={ChevronRight}
          label={t('ui.calendar.nextMonth')}
          onPress={() => shiftMonth(1)}
        />
      </View>
      <View
        className="flex-row"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {weekdays.map((weekday) => (
          <Text
            key={weekday.long}
            variant="caption"
            tone="muted"
            className="flex-1 text-center uppercase"
          >
            {weekday.short}
          </Text>
        ))}
      </View>
      {weeks.map((week, row) => (
        <View key={row} className="flex-row">
          {week.map((day, column) =>
            day ? (
              <CalendarDay
                key={day}
                day={day}
                selected={day === value}
                isToday={day === today}
                locale={locale}
                todayLabel={t('ui.calendar.today')}
                onSelect={onChange}
              />
            ) : (
              <View key={`empty-${column}`} className="h-11 flex-1" />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

interface CalendarDayProps {
  day: CalendarDate;
  selected: boolean;
  isToday: boolean;
  locale: string;
  todayLabel: string;
  onSelect: (day: CalendarDate) => void;
}

const CalendarDay = memo(function CalendarDay({
  day,
  selected,
  isToday,
  locale,
  todayLabel,
  onSelect,
}: CalendarDayProps) {
  const label = formatDay(day, locale, 'long');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isToday ? `${label}, ${todayLabel}` : label}
      accessibilityState={{ selected }}
      onPress={() => onSelect(day)}
      className="h-11 flex-1 items-center justify-center"
    >
      <View
        className={cn(
          'h-10 w-10 items-center justify-center rounded-full',
          selected ? 'bg-primary' : isToday ? 'border-2 border-primary' : 'active:bg-surface-muted',
        )}
      >
        <Text
          variant="body"
          tabular
          tone={selected ? 'onPrimary' : isToday ? 'primary' : 'default'}
          className={selected || isToday ? 'font-sans-bold' : undefined}
        >
          {String(parseCalendarDate(day).day)}
        </Text>
      </View>
    </Pressable>
  );
});
