import { useLocalSearchParams } from 'expo-router';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id de ruta válido o `null`: un enlace mal formado nunca llega a la base. */
export function parseRouteId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

/** Lee y valida un parámetro de ruta con un UUID, como `groupId`. */
export function useRouteId(name: string): string | null {
  const params = useLocalSearchParams();
  return parseRouteId(params[name]);
}

/** Lee un parámetro de ruta que solo admite ciertos valores; si no, devuelve `fallback`. */
export function useRouteChoice<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = useLocalSearchParams()[name];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
