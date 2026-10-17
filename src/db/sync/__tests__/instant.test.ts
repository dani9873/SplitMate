import { parseServerInstant } from '../instant';

describe('parseServerInstant', () => {
  it('lee el formato de Postgres: microsegundos y desfase +00:00', () => {
    expect(parseServerInstant('2026-10-16T12:34:56.789012+00:00')).toBe(
      Date.UTC(2026, 9, 16, 12, 34, 56, 789),
    );
  });

  it('completa o recorta la fracción a milisegundos', () => {
    expect(parseServerInstant('2026-10-16T12:34:56+00:00')).toBe(Date.UTC(2026, 9, 16, 12, 34, 56));
    expect(parseServerInstant('2026-10-16T12:34:56.5Z')).toBe(
      Date.UTC(2026, 9, 16, 12, 34, 56, 500),
    );
    expect(parseServerInstant('2026-10-16T12:34:56.123456789Z')).toBe(
      Date.UTC(2026, 9, 16, 12, 34, 56, 123),
    );
  });

  it('respeta el desfase horario', () => {
    expect(parseServerInstant('2026-10-16T12:00:00-05:00')).toBe(Date.UTC(2026, 9, 16, 17, 0, 0));
    expect(parseServerInstant('2026-10-16T12:00:00+02:00')).toBe(Date.UTC(2026, 9, 16, 10, 0, 0));
  });

  it.each([
    '',
    'ayer',
    '2026-10-16',
    '2026-10-16 12:34:56+00:00',
    '2026-13-16T12:34:56Z',
    '2026-10-16T25:00:00Z',
    '2026-10-16T12:34:56',
  ])('rechaza %j', (value) => {
    expect(parseServerInstant(value)).toBeNull();
  });
});
