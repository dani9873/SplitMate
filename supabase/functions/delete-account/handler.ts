/**
 * Lógica de la Edge Function `delete-account`, sin Deno ni red: las dependencias se inyectan, así
 * se prueba con Jest. `index.ts` crea los clientes de Supabase y la sirve.
 *
 * Reglas:
 * 1. Solo `POST`.
 * 2. Un `Bearer` válido para Supabase, cuyo `sub` es el usuario de la sesión.
 * 3. Sesión reciente: el método de autenticación más reciente del claim `amr` tiene 5 minutos o
 *    menos. Renovar el token conserva el `amr` original, así que una sesión vieja renovada no pasa:
 *    la app pide la contraseña o Google de nuevo.
 * 4. Las respuestas no traen detalles internos.
 */

/** Lo que el manejador necesita de Supabase. */
export interface DeleteAccountDeps {
  /** El usuario del token según Supabase Auth, o `null` si el token no vale. */
  getUser(token: string): Promise<{ id: string } | null>;
  /** Borra la cuenta con la API de administración. `profiles` cae en cascada. */
  deleteUser(id: string): Promise<void>;
  now(): number;
  /** Registro del servidor. Nunca recibe el token. */
  log(message: string, error?: unknown): void;
}

/** Cuánto vale una autenticación para borrar la cuenta. */
export const RECENT_AUTH_SECONDS = 5 * 60;
/** Tolerancia por relojes desfasados: un timestamp apenas en el futuro sigue valiendo. */
const CLOCK_SKEW_SECONDS = 60;

interface Claims {
  readonly sub: string;
  readonly authenticatedAt: number | null;
}

export function createDeleteAccountHandler(deps: DeleteAccountDeps) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    }
    const token = bearerToken(request.headers.get('Authorization'));
    const claims = token ? readClaims(token) : null;
    if (!token || !claims) {
      return json(401, { error: 'unauthorized' });
    }
    try {
      const user = await deps.getUser(token);
      if (!user || user.id !== claims.sub) {
        return json(401, { error: 'unauthorized' });
      }
      const nowSeconds = deps.now() / 1000;
      const recent =
        claims.authenticatedAt !== null &&
        nowSeconds - claims.authenticatedAt <= RECENT_AUTH_SECONDS &&
        claims.authenticatedAt - nowSeconds <= CLOCK_SKEW_SECONDS;
      if (!recent) {
        return json(403, { error: 'reauthentication_required' });
      }
      await deps.deleteUser(user.id);
      return json(200, { deleted: true });
    } catch (error) {
      deps.log('No se pudo borrar la cuenta', error);
      return json(500, { error: 'internal_error' });
    }
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function bearerToken(header: string | null): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header ?? '');
  return match ? match[1]! : null;
}

/**
 * `sub` y el momento de la autenticación más reciente (claim `amr`). Solo se leen: la firma ya la
 * comprobó el gateway (`verify_jwt`) y el usuario lo confirma Supabase Auth.
 */
function readClaims(token: string): Claims | null {
  let payload: unknown;
  try {
    const part = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(part), (char) => char.charCodeAt(0));
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const { sub, amr } = payload as { sub?: unknown; amr?: unknown };
  if (typeof sub !== 'string' || sub.length === 0) {
    return null;
  }
  const timestamps = Array.isArray(amr)
    ? amr
        .map((entry) => (entry as { timestamp?: unknown } | null)?.timestamp)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];
  return { sub, authenticatedAt: timestamps.length > 0 ? Math.max(...timestamps) : null };
}
