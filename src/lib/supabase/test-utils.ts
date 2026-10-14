/**
 * Servidor de Supabase falso para las pruebas: responde como la API de Auth (GoTrue) y la de
 * datos, y registra cada petición. Se pasa a supabase-js como `fetch`, así las pruebas usan el
 * cliente real con sus reglas de errores, PKCE y almacenamiento.
 */
import type { SupportedStorage } from './session-storage';

export const FAKE_SUPABASE_ENV = {
  url: 'https://abcdefghijklmnopqrst.supabase.co',
  publishableKey: 'sb_publishable_pruebas',
} as const;

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Headers;
  readonly body: Record<string, unknown> | undefined;
}

export interface FakeResponse {
  readonly status: number;
  readonly body: unknown;
}

type Handler = (request: FakeRequest) => FakeResponse | Promise<FakeResponse>;

export function createFakeSupabase() {
  const requests: FakeRequest[] = [];
  const routes = new Map<string, Handler>();
  let offline = false;

  async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (offline) {
      throw new TypeError('Network request failed');
    }
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const request: FakeRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const handler = routes.get(`${request.method} ${request.path}`);
    const response = handler
      ? await handler(request)
      : apiError(404, 'not_found', `Sin ruta para ${request.method} ${request.path}`);
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        // Con esta versión, auth-js lee el código de error del campo `code`.
        'x-supabase-api-version': '2024-01-01',
      },
    });
  }

  return {
    fetch,
    requests,
    on(method: string, path: string, handler: Handler | FakeResponse) {
      routes.set(`${method} ${path}`, typeof handler === 'function' ? handler : () => handler);
    },
    setOffline(value: boolean) {
      offline = value;
    },
    /** Peticiones a una ruta, en orden. */
    calls(method: string, path: string) {
      return requests.filter((r) => r.method === method && r.path === path);
    },
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;

export function apiError(status: number, code: string, message: string, extra = {}): FakeResponse {
  return { status, body: { code, message, ...extra } };
}

export const ok = (body: unknown): FakeResponse => ({ status: 200, body });

const base64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** JWT con la forma de los de Supabase. La firma no se verifica en el cliente. */
export function fakeJwt(claims: Record<string, unknown>): string {
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(claims)}.firma-falsa`;
}

export interface FakeUserOptions {
  id?: string;
  email?: string;
  userMetadata?: Record<string, unknown>;
}

export function fakeUser({
  id = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  email = 'ana@example.com',
  userMetadata = { display_name: 'Ana', locale: 'es' },
}: FakeUserOptions = {}) {
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: '2026-10-11T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: userMetadata,
    identities: [],
    created_at: '2026-10-11T00:00:00Z',
    updated_at: '2026-10-11T00:00:00Z',
  };
}

/** Respuesta de `/token` o `/verify`: una sesión con su usuario. */
export function fakeSessionBody(
  user = fakeUser(),
  { expiresIn = 3600, now = Date.now(), refreshToken = 'refresco-1' } = {},
) {
  const iat = Math.floor(now / 1000);
  return {
    access_token: fakeJwt({
      sub: user.id,
      email: user.email,
      role: 'authenticated',
      aud: 'authenticated',
      iat,
      exp: iat + expiresIn,
      amr: [{ method: 'password', timestamp: iat }],
      session_id: 'sesion-1',
    }),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: iat + expiresIn,
    refresh_token: refreshToken,
    user,
  };
}

/** Almacenamiento en memoria con la interfaz que usa supabase-js. */
export function memorySupportedStorage(): SupportedStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}
