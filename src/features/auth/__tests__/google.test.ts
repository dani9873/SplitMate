import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseClient } from '@/lib/supabase/create-client';
import {
  FAKE_SUPABASE_ENV,
  apiError,
  createFakeSupabase,
  fakeSessionBody,
  fakeUser,
  memorySupportedStorage,
  ok,
} from '@/lib/supabase/test-utils';

import { createSupabaseAuthService } from '../auth-service';
import { requestGoogleIdToken, type GoogleAuthModule, type GoogleSignInDeps } from '../google';

const WEB_CLIENT_ID = '1234567890-abcdefghij.apps.googleusercontent.com';

function fakeModule(signIn: GoogleAuthModule['signIn']): GoogleAuthModule & {
  signIn: jest.Mock;
} {
  return { signIn: jest.fn(signIn) };
}

const codedError = (code: string) => Object.assign(new Error(code), { code });

function deps(module: GoogleAuthModule | null, webClientId: string | null = WEB_CLIENT_ID) {
  return {
    module,
    webClientId,
    randomBytes: (length: number) => new Uint8Array(nodeRandomBytes(length)),
    sha256Hex: async (text: string) => createHash('sha256').update(text).digest('hex'),
  } satisfies GoogleSignInDeps;
}

describe('Google', () => {
  describe('ID token con nonce', () => {
    it('Google recibe el hash del nonce y la app guarda el original para Supabase', async () => {
      const module = fakeModule(async () => ({ idToken: 'token-de-google', displayName: 'Ana' }));
      const result = await requestGoogleIdToken(deps(module));

      expect(result).not.toBeNull();
      expect(result!.idToken).toBe('token-de-google');
      expect(result!.nonce).toMatch(/^[0-9a-f]{64}$/);
      const [clientId, hashedNonce] = module.signIn.mock.calls[0]!;
      expect(clientId).toBe(WEB_CLIENT_ID);
      expect(hashedNonce).toBe(createHash('sha256').update(result!.nonce).digest('hex'));
    });

    it('cada intento usa un nonce nuevo', async () => {
      const module = fakeModule(async () => ({ idToken: 't', displayName: null }));
      const first = await requestGoogleIdToken(deps(module));
      const second = await requestGoogleIdToken(deps(module));
      expect(first!.nonce).not.toBe(second!.nonce);
    });

    it('cerrar la hoja de Google no es un error: devuelve null', async () => {
      const module = fakeModule(async () => {
        throw codedError('CANCELED');
      });
      await expect(requestGoogleIdToken(deps(module))).resolves.toBeNull();
    });

    it('sin cuentas de Google en el teléfono avisa con su propio texto', async () => {
      const module = fakeModule(async () => {
        throw codedError('NO_ACCOUNT');
      });
      await expect(requestGoogleIdToken(deps(module))).rejects.toMatchObject({
        code: 'googleNoAccount',
      });
    });

    it('cualquier otra falla del módulo es un fallo de Google', async () => {
      const module = fakeModule(async () => {
        throw codedError('FAILED');
      });
      await expect(requestGoogleIdToken(deps(module))).rejects.toMatchObject({
        code: 'googleFailed',
      });
    });

    it('sin el módulo (iOS, Expo Go) o sin el id del cliente web no se puede usar', async () => {
      await expect(requestGoogleIdToken(deps(null))).rejects.toMatchObject({
        code: 'googleFailed',
      });
      const module = fakeModule(async () => ({ idToken: 't', displayName: null }));
      await expect(requestGoogleIdToken(deps(module, null))).rejects.toMatchObject({
        code: 'googleFailed',
      });
      expect(module.signIn).not.toHaveBeenCalled();
    });
  });

  describe('servicio de auth', () => {
    const clients: SupabaseClient[] = [];

    function setup(module: GoogleAuthModule | null, webClientId: string | null = WEB_CLIENT_ID) {
      const server = createFakeSupabase();
      const storage = memorySupportedStorage();
      const client = createSupabaseClient({ env: FAKE_SUPABASE_ENV, storage, fetch: server.fetch });
      clients.push(client);
      return {
        server,
        service: createSupabaseAuthService(client, storage, deps(module, webClientId)),
      };
    }

    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(async () => {
      for (const client of clients.splice(0)) {
        await client.auth.stopAutoRefresh();
      }
      jest.restoreAllMocks();
    });

    it('canjea el ID token de Google en Supabase con el nonce original', async () => {
      const module = fakeModule(async () => ({ idToken: 'token-de-google', displayName: 'Ana' }));
      const { server, service } = setup(module);
      const googleUser = fakeUser({
        providers: ['google'],
        userMetadata: { full_name: 'Ana García', email: 'ana@example.com' },
      });
      server.on('POST', '/auth/v1/token', ok(fakeSessionBody(googleUser)));

      await expect(service.signInWithGoogle()).resolves.toMatchObject({
        providers: ['google'],
        displayName: 'Ana García',
      });
      const [request] = server.calls('POST', '/auth/v1/token');
      expect(request!.query.get('grant_type')).toBe('id_token');
      expect(request!.body).toMatchObject({ provider: 'google', id_token: 'token-de-google' });
      const hashedNonce = module.signIn.mock.calls[0]![1] as string;
      expect(createHash('sha256').update(String(request!.body!.nonce)).digest('hex')).toBe(
        hashedNonce,
      );
    });

    it('si se cancela, no llama a Supabase', async () => {
      const { server, service } = setup(
        fakeModule(async () => {
          throw codedError('CANCELED');
        }),
      );
      await expect(service.signInWithGoogle()).resolves.toBeNull();
      expect(server.requests).toHaveLength(0);
    });

    it('traduce el rechazo de Supabase', async () => {
      const { server, service } = setup(
        fakeModule(async () => ({ idToken: 't', displayName: null })),
      );
      server.on('POST', '/auth/v1/token', apiError(429, 'over_request_rate_limit', 'Slow down'));
      await expect(service.signInWithGoogle()).rejects.toMatchObject({ code: 'tooManyAttempts' });
    });

    describe('reautenticar para borrar la cuenta', () => {
      const ana = fakeUser({ providers: ['google'], userMetadata: { full_name: 'Ana' } });
      const otra = fakeSessionBody(
        fakeUser({
          id: '01928f3a-7b2c-7d4e-9f10-1a2b3c4d5e6f',
          email: 'beto@example.com',
          providers: ['google'],
        }),
        { refreshToken: 'refresco-otra' },
      );

      function setupReauth(second: unknown) {
        const module = fakeModule(async () => ({ idToken: 'token-de-google', displayName: null }));
        const context = setup(module);
        const responses = [ok(fakeSessionBody(ana)), ok(second)];
        context.server.on('POST', '/auth/v1/token', () => responses.shift()!);
        context.server.on('POST', '/auth/v1/logout', { status: 204, body: undefined });
        context.server.on('GET', '/auth/v1/user', ok(ana));
        return { ...context, module };
      }

      it('con la misma cuenta sigue y no toca la sesión', async () => {
        const { server, service } = setupReauth(fakeSessionBody(ana, { refreshToken: 'nuevo' }));
        const session = (await service.signInWithGoogle())!;

        await expect(service.reauthenticateWithGoogle(session)).resolves.toBe(true);
        expect(server.calls('POST', '/auth/v1/logout')).toHaveLength(0);
      });

      it('con otra cuenta de Google avisa, revoca esa sesión y vuelve la original', async () => {
        const { server, service } = setupReauth(otra);
        const session = (await service.signInWithGoogle())!;

        await expect(service.reauthenticateWithGoogle(session)).rejects.toMatchObject({
          code: 'wrongAccount',
        });
        const [logout] = server.calls('POST', '/auth/v1/logout');
        expect(logout!.headers.get('authorization')).toBe(`Bearer ${otra.access_token}`);
        await expect(service.restore()).resolves.toMatchObject({ userId: session.userId });
      });

      it('si cierra la hoja, devuelve false sin llamar a Supabase', async () => {
        const { server, service, module } = setupReauth(otra);
        const session = (await service.signInWithGoogle())!;
        module.signIn.mockRejectedValueOnce(codedError('CANCELED'));
        const before = server.requests.length;

        await expect(service.reauthenticateWithGoogle(session)).resolves.toBe(false);
        expect(server.requests).toHaveLength(before);
      });
    });

    it('dice si Google está disponible', () => {
      const module = fakeModule(async () => ({ idToken: 't', displayName: null }));
      expect(setup(module).service.canUseGoogle()).toBe(true);
      expect(setup(null).service.canUseGoogle()).toBe(false);
      expect(setup(module, null).service.canUseGoogle()).toBe(false);
    });
  });
});
