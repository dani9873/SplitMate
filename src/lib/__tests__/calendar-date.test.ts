/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  addDays,
  fromParts,
  isCalendarDate,
  monthGrid,
  parseCalendarDate,
  relativeDay,
} from '../calendar-date';

/**
 * Ejecuta `snippet` (una función que recibe el módulo) en un proceso de Node con la zona
 * horaria forzada. Jest no permite cambiar la zona dentro de su proceso: su `process.env`
 * es una copia y la zona local queda fija al arrancar.
 */
function inTimeZone<T>(tz: string, snippet: string): T {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'calendar-date.ts')).href;
  const code = [
    `process.env.TZ = ${JSON.stringify(tz)};`,
    `const m = await import(${JSON.stringify(moduleUrl)});`,
    `console.log(JSON.stringify((${snippet})(m)));`,
  ].join(' ');
  const output = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', code],
    { encoding: 'utf8' },
  );
  return JSON.parse(output) as T;
}

describe('días de calendario locales', () => {
  it('hoy es la fecha local aunque en UTC ya sea el día siguiente', () => {
    // 23:30 del 9 de octubre en Bogotá (UTC−5) son las 04:30 UTC del 10.
    const result = inTimeZone<{ utc: string; today: string }>(
      'America/Bogota',
      `(m) => { const night = new Date(2026, 9, 9, 23, 30);
        return { utc: night.toISOString(), today: m.today(night) }; }`,
    );
    expect(result).toEqual({ utc: '2026-10-10T04:30:00.000Z', today: '2026-10-09' });
  });

  it('hoy es la fecha local aunque en UTC todavía sea el día anterior', () => {
    // 08:00 del 10 de octubre en Kiritimati (UTC+14) son las 18:00 UTC del 9.
    const result = inTimeZone<{ utc: string; today: string }>(
      'Pacific/Kiritimati',
      `(m) => { const morning = new Date(2026, 9, 10, 8, 0);
        return { utc: morning.toISOString(), today: m.today(morning) }; }`,
    );
    expect(result).toEqual({ utc: '2026-10-09T18:00:00.000Z', today: '2026-10-10' });
  });

  it('muestra el mismo día en cualquier zona horaria', () => {
    for (const tz of ['Pacific/Kiritimati', 'America/Bogota', 'Pacific/Pago_Pago', 'UTC']) {
      const result = inTimeZone<string[]>(
        tz,
        `(m) => [
          m.formatCalendarDate('2026-10-09', 'es', { day: 'numeric', month: 'long' }),
          m.formatCalendarDate('2026-01-01', 'en-US', { dateStyle: 'medium' }),
        ]`,
      );
      expect(result).toEqual(['9 de octubre', 'Jan 1, 2026']);
    }
  });

  it('suma días sin correrse en el cambio de horario', () => {
    const result = inTimeZone<string[]>(
      'America/New_York',
      `(m) => [m.addDays('2026-03-07', 1), m.addDays('2026-03-08', 1), m.addDays('2026-11-01', 1)]`,
    );
    expect(result).toEqual(['2026-03-08', '2026-03-09', '2026-11-02']);
  });

  it('suma días cruzando meses, años y años bisiestos', () => {
    expect(addDays('2026-10-09', -1)).toBe('2026-10-08');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('valida el formato y que el día exista', () => {
    expect(isCalendarDate('2026-10-09')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2027-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-10-9')).toBe(false);
    expect(isCalendarDate('2026-10-09T00:00')).toBe(false);
  });

  it('separa y compone las partes de la fecha', () => {
    expect(parseCalendarDate('2026-10-09')).toEqual({ year: 2026, month: 10, day: 9 });
    expect(fromParts(2026, 1, 5)).toBe('2026-01-05');
    expect(() => parseCalendarDate('9/10/2026')).toThrow(RangeError);
  });

  it('dice si un día es hoy o ayer', () => {
    expect(relativeDay('2026-10-09', '2026-10-09')).toBe('today');
    expect(relativeDay('2026-10-08', '2026-10-09')).toBe('yesterday');
    expect(relativeDay('2026-09-30', '2026-10-01')).toBe('yesterday');
    expect(relativeDay('2026-10-07', '2026-10-09')).toBeNull();
    expect(relativeDay('2026-10-10', '2026-10-09')).toBeNull();
  });

  it('arma la cuadrícula del mes empezando en lunes o en domingo', () => {
    // Octubre de 2026 empieza en jueves y tiene 31 días.
    const monday = monthGrid(2026, 10, 1);
    expect(monday[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(monday.flat().filter(Boolean)).toHaveLength(31);
    expect(monday.every((week) => week.length === 7)).toBe(true);

    const sunday = monthGrid(2026, 10, 0);
    expect(sunday[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(sunday.at(-1)).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
  });
});
