/**
 * Día de calendario `YYYY-MM-DD`, sin hora ni zona horaria.
 *
 * La fecha de un movimiento es el día en que ocurrió para quien lo registró: un gasto del
 * 9 de octubre es del 9 de octubre en cualquier zona horaria y no cambia de día al
 * sincronizar. Los instantes (`created_at`, `updated_at`...) siguen siendo UTC.
 *
 * Para calcular y mostrar, cada día se representa como la medianoche UTC de esa fecha y se
 * formatea con `timeZone: 'UTC'`: así ningún desfase local lo mueve.
 */
export type CalendarDate = string;

export interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const pad = (value: number, length: number) => String(value).padStart(length, '0');

export function fromParts(year: number, month: number, day: number): CalendarDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function isCalendarDate(value: string): boolean {
  const match = PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function parseCalendarDate(value: CalendarDate): CalendarParts {
  if (!isCalendarDate(value)) {
    throw new RangeError(`Fecha de calendario inválida: "${value}"`);
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

/** Medianoche UTC del día, para operar y formatear sin depender de la zona local. */
export function toUtcDate(value: CalendarDate): Date {
  const { year, month, day } = parseCalendarDate(value);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtcDate(date: Date): CalendarDate {
  return fromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Fecha local del dispositivo. `toISOString()` daría la fecha UTC, que puede ser otra. */
export function today(now: Date = new Date()): CalendarDate {
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(value: CalendarDate, days: number): CalendarDate {
  return fromUtcDate(new Date(toUtcDate(value).getTime() + days * DAY_MS));
}

/** `today` o `yesterday` respecto a `reference`; `null` para cualquier otro día. */
export function relativeDay(
  value: CalendarDate,
  reference: CalendarDate,
): 'today' | 'yesterday' | null {
  if (value === reference) {
    return 'today';
  }
  return addDays(value, 1) === reference ? 'yesterday' : null;
}

/** Formatea el día con `Intl` sin que la zona horaria lo corra. */
export function formatCalendarDate(
  value: CalendarDate,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(toUtcDate(value));
}

/**
 * Semanas del mes, de 7 días cada una, con `null` en los huecos antes del día 1 y después
 * del último. `weekStartsOn`: 0 domingo, 1 lunes.
 */
export function monthGrid(
  year: number,
  month: number,
  weekStartsOn: 0 | 1,
): (CalendarDate | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leading = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const cells: (CalendarDate | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => fromParts(year, month, index + 1)),
  ];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}
