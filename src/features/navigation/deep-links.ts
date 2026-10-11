import { z } from 'zod';

/** Largo máximo de un enlace entrante. Uno más largo ni se interpreta. */
export const MAX_LINK_LENGTH = 2048;

/** `splitmate://ruta?consulta#fragmento`, la ruta sola o con `/` inicial. */
const LINK_PATTERN = /^(?:splitmate:\/\/\/?|\/)?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

const callbackSchema = z.union([
  z.object({
    code: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
    sb_flow_id: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
  }),
  z.object({
    error: z.string().regex(/^[a-z_]{1,64}$/),
    error_code: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/)
      .optional(),
    // Se acepta acotada pero no se reenvía: la app explica el error con su propio texto.
    error_description: z.string().max(512).optional(),
  }),
]);

/**
 * Decide a qué ruta lleva un enlace que llega desde fuera de la app, antes de que Expo Router lo
 * interprete. La app solo recibe `auth/callback`, el destino de los correos de Supabase, con su
 * código o su error validados. Todo lo demás (rutas desconocidas, parámetros raros, enlaces
 * enormes o mal codificados) va al inicio.
 */
export function resolveIncomingLink(link: string): string {
  if (link.length > MAX_LINK_LENGTH) {
    return '/';
  }
  const match = LINK_PATTERN.exec(link);
  if (!match) {
    return '/';
  }
  const [, path = '', query, fragment] = match;
  if (path.replace(/\/+$/, '') !== 'auth/callback') {
    return '/';
  }
  const fromQuery = parseParams(query);
  const fromFragment = parseParams(fragment);
  if (!fromQuery || !fromFragment || [...fromQuery.keys()].some((key) => fromFragment.has(key))) {
    return '/';
  }
  const parsed = callbackSchema.safeParse(Object.fromEntries([...fromQuery, ...fromFragment]));
  if (!parsed.success) {
    return '/';
  }
  const params = new URLSearchParams();
  if ('code' in parsed.data) {
    params.set('code', parsed.data.code);
    if (parsed.data.sb_flow_id) {
      params.set('sb_flow_id', parsed.data.sb_flow_id);
    }
  } else {
    params.set('error', parsed.data.error);
    if (parsed.data.error_code) {
      params.set('error_code', parsed.data.error_code);
    }
  }
  return `/auth/callback?${params.toString()}`;
}

/**
 * Parámetros de una consulta o un fragmento. `null` si hay codificación rota o repetidos. Un
 * `Map`, no un objeto: una clave como `__proto__` no toca nada.
 */
function parseParams(text: string | undefined): Map<string, string> | null {
  const params = new Map<string, string>();
  if (!text) {
    return params;
  }
  for (const pair of text.split('&')) {
    if (!pair) {
      continue;
    }
    const separator = pair.indexOf('=');
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? '' : pair.slice(separator + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      return null;
    }
    if (params.has(key)) {
      return null;
    }
    params.set(key, value);
  }
  return params;
}
