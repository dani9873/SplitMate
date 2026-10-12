import type { SupabaseClient } from '@supabase/supabase-js';

import { SESSION_STORAGE_KEY, createSupabaseClient } from '@/lib/supabase/create-client';
import {
  FAKE_SUPABASE_ENV,
  apiError,
  createFakeSupabase,
  fakeSessionBody,
  fakeUser,
  memorySupportedStorage,
  ok,
  type FakeSupabase,
} from '@/lib/supabase/test-utils';

import { AuthError } from '../auth-errors';
import { AUTH_REDIRECT_URL, createSupabaseAuthService, type AuthService } from '../auth-service';
import { TEST_SESSION as SESSION } from '../test-utils';

const EMAIL = 'ana@example.com';
const PASSWORD = 'una contraseña larga';

const clients: SupabaseClient[] = [];

function setup(
  server: FakeSupabase = createFakeSupabase(),
  storage = memorySupportedStorage(),
): { server: FakeSupabase; storage: typeof storage; service: AuthService } {
  const client = createSupabaseClient({ env: FAKE_SUPABASE_ENV, storage, fetch: server.fetch });
  clients.push(client);
  return { server, storage, service: createSupabaseAuthService(client, storage) };
}

async function rejection(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AuthError) {
      return error;
    }
    throw error;
  }
  throw new Error('Se esperaba un AuthError');
}

beforeEach(() => {
  // auth-js registra en consola los fallos de red y de renovación; aquí son esperados.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.auth.stopAutoRefresh();
  }
  jest.restoreAllMocks();
});

describe('servicio de auth con supabase-js', () => {
  describe('entrar', () => {
    it('devuelve la sesión con id, correo, proveedores y nombre, y la guarda', async () => {
      const { server, service, storage } = setup();
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));

      await expect(service.signIn(EMAIL, PASSWORD)).resolves.toEqual({
        userId: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        email: EMAIL,
        providers: ['email'],
        displayName: 'Ana',
      });
      const [request] = server.calls('POST', '/auth/v1/token');
      expect(request!.query.get('grant_type')).toBe('password');
      expect(request!.body).toMatchObject({ email: EMAIL, password: PASSWORD });
      expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(true);
    });

    it.each([
      [400, 'invalid_credentials', 'invalidCredentials'],
      [400, 'email_not_confirmed', 'emailNotConfirmed'],
      [429, 'over_request_rate_limit', 'tooManyAttempts'],
      [400, 'email_address_invalid', 'invalidEmail'],
      [400, 'email_address_not_authorized', 'emailNotAllowed'],
      [500, 'unexpected_failure', 'unavailable'],
      [418, 'algo_nuevo', 'unknown'],
    ])('traduce %i %s a %s', async (status, code, expected) => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/token', apiError(status, code, 'Mensaje de Supabase'));
      await expect(rejection(service.signIn(EMAIL, PASSWORD))).resolves.toMatchObject({
        code: expected,
      });
    });

    it('sin red, avisa que no hay conexión', async () => {
      const { server, service } = setup();
      server.setOffline(true);
      await expect(rejection(service.signIn(EMAIL, PASSWORD))).resolves.toMatchObject({
        code: 'offline',
      });
    });
  });

  describe('registro', () => {
    it('envía nombre e idioma en los metadatos, la redirección de la app y PKCE S256', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/signup', ok(fakeUser()));

      await service.signUp({
        email: EMAIL,
        password: PASSWORD,
        displayName: 'Ana',
        locale: 'es',
      });

      const [request] = server.calls('POST', '/auth/v1/signup');
      expect(request!.body).toMatchObject({
        email: EMAIL,
        password: PASSWORD,
        data: { display_name: 'Ana', locale: 'es' },
        code_challenge_method: 's256',
      });
      // Exacta: Supabase la compara con la lista de redirecciones permitidas, query incluida.
      expect(request!.query.get('redirect_to')).toBe(AUTH_REDIRECT_URL);
    });

    it('con un correo ya registrado termina igual, sin revelar la cuenta', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/signup', apiError(422, 'user_already_exists', 'User exists'));
      await expect(
        service.signUp({ email: EMAIL, password: PASSWORD, displayName: 'Ana', locale: 'es' }),
      ).resolves.toBeUndefined();
    });

    it('traduce una contraseña débil', async () => {
      const { server, service } = setup();
      server.on(
        'POST',
        '/auth/v1/signup',
        apiError(422, 'weak_password', 'Password should be at least 8 characters.', {
          weak_password: { reasons: ['length'] },
        }),
      );
      await expect(
        rejection(
          service.signUp({ email: EMAIL, password: 'corta', displayName: 'Ana', locale: 'es' }),
        ),
      ).resolves.toMatchObject({ code: 'weakPassword' });
    });
  });

  describe('códigos y enlaces del correo', () => {
    it('verifica el código de registro y devuelve la sesión', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/verify', ok(fakeSessionBody()));

      await expect(service.verifyCode(EMAIL, '123456', 'signup')).resolves.toMatchObject({
        userId: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      });
      expect(server.calls('POST', '/auth/v1/verify')[0]!.body).toMatchObject({
        email: EMAIL,
        token: '123456',
        type: 'signup',
      });
    });

    it('verifica el código de recuperación con su tipo', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/verify', ok(fakeSessionBody()));
      await service.verifyCode(EMAIL, '654321', 'recovery');
      expect(server.calls('POST', '/auth/v1/verify')[0]!.body).toMatchObject({ type: 'recovery' });
    });

    it('traduce un código vencido o equivocado', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/verify', apiError(403, 'otp_expired', 'Token has expired'));
      await expect(rejection(service.verifyCode(EMAIL, '000000', 'signup'))).resolves.toMatchObject(
        { code: 'invalidCode' },
      );
    });

    it('reenvía el correo de registro con la redirección de la app', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/resend', ok({}));
      await service.resend(EMAIL, 'signup');
      const [request] = server.calls('POST', '/auth/v1/resend');
      expect(request!.body).toMatchObject({ email: EMAIL, type: 'signup' });
      expect(request!.query.get('redirect_to')).toBe(AUTH_REDIRECT_URL);
    });

    it('reenviar la recuperación pide otro correo de recuperación', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/recover', ok({}));
      await service.resend(EMAIL, 'recovery');
      expect(server.calls('POST', '/auth/v1/recover')).toHaveLength(1);
    });

    it('canjea el código del enlace de recuperación con el verificador PKCE guardado', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/recover', ok({}));
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));

      await service.requestPasswordReset(EMAIL);
      const [recover] = server.calls('POST', '/auth/v1/recover');
      expect(recover!.body).toMatchObject({ email: EMAIL, code_challenge_method: 's256' });
      expect(recover!.query.get('redirect_to')).toBe(AUTH_REDIRECT_URL);

      await expect(service.exchangeCode('codigo-del-correo', null)).resolves.toMatchObject({
        recovery: true,
        session: { email: EMAIL },
      });
      const [exchange] = server.calls('POST', '/auth/v1/token');
      expect(exchange!.query.get('grant_type')).toBe('pkce');
      expect(exchange!.body).toMatchObject({ auth_code: 'codigo-del-correo' });
      expect(String(exchange!.body!.code_verifier)).toMatch(/^[0-9a-f]{56,}$/);
    });

    it('un enlace sin su verificador en este teléfono se trata como vencido', async () => {
      const { service } = setup();
      await expect(
        rejection(service.exchangeCode('codigo', '0123456789abcdef0123456789abcdef')),
      ).resolves.toMatchObject({ code: 'linkExpired' });
    });

    it('pedir la recuperación no revela si el correo existe', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/recover', ok({}));
      await expect(service.requestPasswordReset('nadie@example.com')).resolves.toBeUndefined();
    });

    it('cambia la contraseña con la sesión de recuperación', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/verify', ok(fakeSessionBody()));
      server.on('PUT', '/auth/v1/user', ok(fakeUser()));

      await service.verifyCode(EMAIL, '654321', 'recovery');
      await service.updatePassword('otra contraseña larga');
      expect(server.calls('PUT', '/auth/v1/user')[0]!.body).toMatchObject({
        password: 'otra contraseña larga',
      });
    });

    it('traduce una contraseña nueva igual a la anterior', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/verify', ok(fakeSessionBody()));
      server.on('PUT', '/auth/v1/user', apiError(422, 'same_password', 'Same password'));
      await service.verifyCode(EMAIL, '654321', 'recovery');
      await expect(rejection(service.updatePassword(PASSWORD))).resolves.toMatchObject({
        code: 'samePassword',
      });
    });
  });

  describe('restaurar la sesión', () => {
    it('sin sesión guardada devuelve null', async () => {
      const { service } = setup();
      await expect(service.restore()).resolves.toBeNull();
    });

    it('sin red devuelve la sesión guardada, sin llamar a Supabase', async () => {
      const first = setup();
      first.server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));
      await first.service.signIn(EMAIL, PASSWORD);

      const offline = createFakeSupabase();
      offline.setOffline(true);
      const { service } = setup(offline, first.storage);
      await expect(service.restore()).resolves.toMatchObject({
        userId: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        email: EMAIL,
      });
      expect(offline.requests).toHaveLength(0);
    });

    it('sin red, una sesión vencida sigue guardada para renovarla al volver la red', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-11T12:00:00Z') });
      try {
        const storage = memorySupportedStorage();
        const expired = fakeSessionBody(fakeUser(), {
          expiresIn: 3600,
          now: Date.now() - 2 * 3600 * 1000,
        });
        await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(expired));

        const offline = createFakeSupabase();
        offline.setOffline(true);
        const { service } = setup(offline, storage);
        // Agota los reintentos de renovación de supabase-js.
        await jest.advanceTimersByTimeAsync(60_000);

        expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(true);
        await expect(service.restore()).resolves.toMatchObject({ email: EMAIL });
      } finally {
        jest.useRealTimers();
      }
    });

    it('descarta una sesión guardada con forma inválida', async () => {
      const storage = memorySupportedStorage();
      await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ user: { id: 'no-es-uuid' } }));
      const { service } = setup(createFakeSupabase(), storage);
      await expect(service.restore()).resolves.toBeNull();
    });

    it('avisa cuando Supabase rechaza la sesión de forma definitiva', async () => {
      const storage = memorySupportedStorage();
      const expired = fakeSessionBody(fakeUser(), { now: Date.now() - 2 * 3600 * 1000 });
      await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(expired));
      const server = createFakeSupabase();
      server.on(
        'POST',
        '/auth/v1/token',
        apiError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'),
      );

      const signedOut = new Promise<void>((resolve) => {
        const { service } = setup(server, storage);
        service.onSignedOut(resolve);
      });
      await signedOut;
      expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
    });
  });

  describe('borrar la cuenta', () => {
    it('reautenticar con la contraseña crea una sesión nueva', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));
      await service.reauthenticateWithPassword(SESSION, PASSWORD);
      expect(server.calls('POST', '/auth/v1/token')[0]!.body).toMatchObject({
        email: EMAIL,
        password: PASSWORD,
      });
    });

    describe('si al reautenticar entra otra cuenta', () => {
      const OTHER = fakeSessionBody(
        fakeUser({ id: '01928f3a-7b2c-7d4e-9f10-1a2b3c4d5e6f', email: 'beto@example.com' }),
        { refreshToken: 'refresco-otra' },
      );

      function setupWithOther() {
        const context = setup();
        const responses = [ok(fakeSessionBody()), ok(OTHER)];
        context.server.on('POST', '/auth/v1/token', () => responses.shift()!);
        context.server.on('POST', '/auth/v1/logout', { status: 204, body: undefined });
        const signedOut = jest.fn();
        context.service.onSignedOut(signedOut);
        return { ...context, signedOut };
      }

      it('revoca la sesión de la otra cuenta, devuelve la original y avisa sin cerrar sesión', async () => {
        const { server, service, signedOut } = setupWithOther();
        server.on('GET', '/auth/v1/user', ok(fakeUser()));
        await service.signIn(EMAIL, PASSWORD);

        await expect(
          rejection(service.reauthenticateWithPassword(SESSION, PASSWORD)),
        ).resolves.toMatchObject({ code: 'wrongAccount' });
        const [logout] = server.calls('POST', '/auth/v1/logout');
        expect(logout!.headers.get('authorization')).toBe(`Bearer ${OTHER.access_token}`);
        expect(logout!.query.get('scope')).toBe('local');
        await expect(service.restore()).resolves.toMatchObject({ userId: SESSION.userId });
        expect(signedOut).not.toHaveBeenCalled();
      });

      it('si la sesión original ya no sirve, cierra la sesión de este teléfono', async () => {
        const { server, service, signedOut } = setupWithOther();
        server.on('GET', '/auth/v1/user', apiError(401, 'bad_jwt', 'Invalid JWT'));
        await service.signIn(EMAIL, PASSWORD);

        await expect(
          rejection(service.reauthenticateWithPassword(SESSION, PASSWORD)),
        ).resolves.toMatchObject({ code: 'wrongAccount' });
        await expect(service.restore()).resolves.toBeNull();
        expect(signedOut).toHaveBeenCalled();
      });
    });

    it('reautenticar con una contraseña equivocada no revela nada más', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/token', apiError(400, 'invalid_credentials', 'Invalid'));
      await expect(
        rejection(service.reauthenticateWithPassword(SESSION, 'otra')),
      ).resolves.toMatchObject({ code: 'invalidCredentials' });
    });

    it('llama a la Edge Function con la sesión y termina sin error', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));
      server.on('POST', '/functions/v1/delete-account', ok({ deleted: true }));
      await service.signIn(EMAIL, PASSWORD);

      await service.deleteAccount();
      const [request] = server.calls('POST', '/functions/v1/delete-account');
      expect(request!.headers.get('authorization')).toMatch(/^Bearer ey/);
    });

    it.each([
      [403, { error: 'reauthentication_required' }, 'reauthenticationRequired'],
      [401, { error: 'unauthorized' }, 'sessionExpired'],
      [500, { error: 'internal_error' }, 'unavailable'],
    ])('traduce la respuesta %i de la Edge Function', async (status, body, code) => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));
      server.on('POST', '/functions/v1/delete-account', { status, body });
      await service.signIn(EMAIL, PASSWORD);
      await expect(rejection(service.deleteAccount())).resolves.toMatchObject({ code });
    });

    it('sin red avisa que no hay conexión', async () => {
      const { server, service } = setup();
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));
      await service.signIn(EMAIL, PASSWORD);
      server.setOffline(true);
      await expect(rejection(service.deleteAccount())).resolves.toMatchObject({ code: 'offline' });
    });
  });

  describe('cerrar sesión', () => {
    it('revoca la sesión de este teléfono y la borra', async () => {
      const { server, service, storage } = setup();
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));
      server.on('POST', '/auth/v1/logout', { status: 204, body: undefined });
      await service.signIn(EMAIL, PASSWORD);

      await service.signOut();
      expect(server.calls('POST', '/auth/v1/logout')[0]!.query.get('scope')).toBe('local');
      expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
      await expect(service.restore()).resolves.toBeNull();
    });

    it('sin red borra igual la sesión local', async () => {
      const { server, service, storage } = setup();
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody()));
      await service.signIn(EMAIL, PASSWORD);
      server.setOffline(true);

      await service.signOut();
      expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
      await expect(service.restore()).resolves.toBeNull();
    });
  });
});
