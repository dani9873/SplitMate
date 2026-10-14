/**
 * @jest-environment node
 */
import {
  RECENT_AUTH_SECONDS,
  createDeleteAccountHandler,
  type DeleteAccountDeps,
} from '../handler';

const USER_ID = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NOW = Date.parse('2026-10-11T12:00:00Z');
const nowSeconds = Math.floor(NOW / 1000);

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(claims: Record<string, unknown>): string {
  return `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url(claims)}.firma`;
}

/** Token de una sesión que se autenticó hace `secondsAgo` segundos. */
const sessionToken = (secondsAgo: number, extra: Record<string, unknown> = {}) =>
  token({
    sub: USER_ID,
    role: 'authenticated',
    exp: nowSeconds + 3600,
    amr: [{ method: 'password', timestamp: nowSeconds - secondsAgo }],
    user_metadata: { display_name: 'Ana García' },
    ...extra,
  });

function setup(overrides: Partial<DeleteAccountDeps> = {}) {
  const deps = {
    getUser: jest.fn(async () => ({ id: USER_ID })),
    deleteUser: jest.fn(async () => undefined),
    now: () => NOW,
    log: jest.fn(),
    ...overrides,
  };
  return { deps, handle: createDeleteAccountHandler(deps) };
}

const request = (init: RequestInit & { token?: string } = {}) =>
  new Request('https://proyecto.supabase.co/functions/v1/delete-account', {
    method: init.method ?? 'POST',
    headers: init.token ? { Authorization: `Bearer ${init.token}` } : {},
  });

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('Edge Function delete-account', () => {
  it('solo acepta POST', async () => {
    const { handle, deps } = setup();
    const response = await handle(request({ method: 'GET', token: sessionToken(10) }));
    expect(await read(response)).toEqual({ status: 405, body: { error: 'method_not_allowed' } });
    expect(response.headers.get('Allow')).toBe('POST');
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it.each([
    ['sin token', undefined],
    ['con un token mal formado', 'no-es-un-jwt'],
    ['con un token sin sub', token({ amr: [{ method: 'password', timestamp: nowSeconds }] })],
  ])('401 %s', async (_, value) => {
    const { handle, deps } = setup();
    expect(await read(await handle(request({ token: value })))).toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it('401 si Supabase no reconoce el token', async () => {
    const { handle, deps } = setup({ getUser: jest.fn(async () => null) });
    expect((await handle(request({ token: sessionToken(10) }))).status).toBe(401);
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it('401 si el sub del token no es el usuario de la sesión', async () => {
    const { handle, deps } = setup({
      getUser: jest.fn(async () => ({ id: '7a2b3c4d-5e6f-4a7b-9c8d-0e1f2a3b4c5d' })),
    });
    expect((await handle(request({ token: sessionToken(10) }))).status).toBe(401);
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it(`403 reauthentication_required si la sesión se autenticó hace más de ${RECENT_AUTH_SECONDS / 60} minutos`, async () => {
    const { handle, deps } = setup();
    const response = await handle(request({ token: sessionToken(RECENT_AUTH_SECONDS + 1) }));
    expect(await read(response)).toEqual({
      status: 403,
      body: { error: 'reauthentication_required' },
    });
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it('403 si el token no dice cuándo se autenticó', async () => {
    const { handle } = setup();
    const withoutAmr = token({ sub: USER_ID, exp: nowSeconds + 3600 });
    expect((await handle(request({ token: withoutAmr }))).status).toBe(403);
  });

  it('cuenta el método de autenticación más reciente', async () => {
    const { handle, deps } = setup();
    const response = await handle(
      request({
        token: sessionToken(0, {
          amr: [
            { method: 'password', timestamp: nowSeconds - 86_400 },
            { method: 'oauth', timestamp: nowSeconds - 30 },
          ],
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(deps.deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it('con una sesión reciente borra la cuenta y responde 200', async () => {
    const { handle, deps } = setup();
    const response = await handle(request({ token: sessionToken(RECENT_AUTH_SECONDS - 5) }));
    expect(await read(response)).toEqual({ status: 200, body: { deleted: true } });
    expect(deps.getUser).toHaveBeenCalledWith(sessionToken(RECENT_AUTH_SECONDS - 5));
    expect(deps.deleteUser).toHaveBeenCalledWith(USER_ID);
  });

  it('500 sin detalles si borrar falla', async () => {
    const { handle, deps } = setup({
      deleteUser: jest.fn(async () => {
        throw new Error('detalle interno: conexión a la base rechazada');
      }),
    });
    const response = await handle(request({ token: sessionToken(10) }));
    const { status, body } = await read(response);
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(body)).not.toContain('detalle interno');
    expect(deps.log).toHaveBeenCalledTimes(1);
  });

  it('500 sin detalles si Supabase falla al leer el usuario', async () => {
    const { handle } = setup({
      getUser: jest.fn(async () => {
        throw new Error('timeout');
      }),
    });
    expect(await read(await handle(request({ token: sessionToken(10) })))).toEqual({
      status: 500,
      body: { error: 'internal_error' },
    });
  });
});
