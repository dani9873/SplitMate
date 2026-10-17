const PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Milisegundos Unix de un `timestamptz` como lo serializa Postgres (`to_jsonb`): fracción de
 * microsegundos y desfase `+00:00`. La fracción se lleva a tres dígitos antes de leerla, porque no
 * todos los motores de JavaScript aceptan más. Devuelve `null` si no es una fecha con hora y
 * desfase, o si no existe.
 */
export function parseServerInstant(value: string): number | null {
  const match = PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, date, time, fraction = '', zone] = match;
  const millis = fraction.slice(0, 3).padEnd(3, '0');
  const parsed = Date.parse(`${date}T${time}.${millis}${zone}`);
  return Number.isNaN(parsed) ? null : parsed;
}
