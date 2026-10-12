import { userEvent } from '@testing-library/react-native';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { openAccountDatabase } from '@/db/client';
import { createTestDatabase } from '@/db/test-utils';
import { changeLanguage } from '@/i18n';

import { AuthError } from '../auth-errors';
import { AuthProvider } from '../AuthProvider';
import { RootNavigator } from '../../navigation/RootNavigator';
import { TEST_SESSION, createFakeAuthService, type FakeAuthService } from '../test-utils';

jest.mock('@/db/client', () => ({ openAccountDatabase: jest.fn() }));
jest.mock('@/db/app-deps', () => {
  const { createIdGenerator } = jest.requireActual('@/lib/ids');
  let time = 1_760_000_000_000;
  const now = () => (time += 1);
  return {
    appRepositoryDeps: {
      now,
      newId: createIdGenerator({ now, randomBytes: (n: number) => new Uint8Array(n).fill(7) }),
    },
  };
});

// Teléfono en español: así lo aplican las preferencias al hidratarse, a mitad de una prueba.
jest.mock('expo-localization', () => {
  const locales = [{ languageCode: 'es', languageTag: 'es-CO', regionCode: 'CO' }];
  return { getLocales: () => locales, useLocales: () => locales };
});

const route = (path: string) => require(`../../../../app/${path}`).default;

let service: FakeAuthService;

function TestRoot() {
  return (
    <AuthProvider service={service}>
      <RootNavigator />
    </AuthProvider>
  );
}

const routes = () => ({
  _layout: TestRoot,
  '(auth)/_layout': route('(auth)/_layout'),
  '(auth)/welcome': route('(auth)/welcome'),
  '(auth)/sign-up': route('(auth)/sign-up'),
  '(auth)/sign-in': route('(auth)/sign-in'),
  '(auth)/check-email': route('(auth)/check-email'),
  '(auth)/forgot-password': route('(auth)/forgot-password'),
  'auth/callback': route('auth/callback'),
  'reset-password': route('reset-password'),
  '(app)/_layout': route('(app)/_layout'),
  '(app)/(tabs)/_layout': route('(app)/(tabs)/_layout'),
  '(app)/(tabs)/index': route('(app)/(tabs)/index'),
  '(app)/(tabs)/activity': route('(app)/(tabs)/activity'),
  '(app)/(tabs)/settings': route('(app)/(tabs)/settings'),
});

type User = ReturnType<typeof userEvent.setup>;

async function press(user: User, testID: string) {
  await user.press(await screen.findByTestId(testID));
}

const EMAIL = 'ana@example.com';
const PASSWORD = 'una contraseña larga';

describe('pantallas de auth', () => {
  beforeEach(async () => {
    const { db } = await createTestDatabase();
    jest.mocked(openAccountDatabase).mockResolvedValue({ db, close: jest.fn() });
    await act(() => changeLanguage('es'));
  });

  afterAll(async () => {
    await act(() => changeLanguage('en'));
  });

  describe('registro', () => {
    it('crear cuenta → revisa tu correo → código → la app', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService();
      await renderRouter(routes(), { initialUrl: '/' });

      await press(user, 'welcome-create-account');
      await user.type(await screen.findByTestId('sign-up-name'), ' Ana ');
      await user.type(screen.getByTestId('sign-up-email'), EMAIL);
      await user.type(screen.getByTestId('sign-up-password'), PASSWORD);
      await press(user, 'sign-up-submit');

      expect(service.signUp).toHaveBeenCalledWith({
        email: EMAIL,
        password: PASSWORD,
        displayName: 'Ana',
        locale: 'es',
      });
      expect(await screen.findByTestId('check-email-screen')).toBeOnTheScreen();
      expect(screen.getByText(/Te enviamos un correo a ana@example\.com/)).toBeOnTheScreen();

      await user.type(screen.getByTestId('check-email-code'), '123456');
      await press(user, 'check-email-submit');

      expect(service.verifyCode).toHaveBeenCalledWith(EMAIL, '123456', 'signup');
      expect(await screen.findByTestId('groups-screen')).toBeOnTheScreen();
    });

    it('valida los campos y enfoca el formulario sin llamar al servicio', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService();
      await renderRouter(routes(), { initialUrl: '/sign-up' });

      await press(user, 'sign-up-submit');
      expect(await screen.findByText('Escribe tu nombre.')).toBeOnTheScreen();
      expect(screen.getByText('Escribe tu correo.')).toBeOnTheScreen();
      expect(screen.getByText('Escribe la contraseña.')).toBeOnTheScreen();

      await user.type(screen.getByTestId('sign-up-name'), 'Ana');
      await user.type(screen.getByTestId('sign-up-email'), 'ana@');
      await user.type(screen.getByTestId('sign-up-password'), 'corta');
      await press(user, 'sign-up-submit');
      expect(await screen.findByText('Revisa el correo: parece incompleto.')).toBeOnTheScreen();
      expect(screen.getByText('Usa al menos 8 caracteres.')).toBeOnTheScreen();
      expect(service.signUp).not.toHaveBeenCalled();
    });

    it('muestra el error del servicio con su texto propio', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        signUp: async () => {
          throw new AuthError('weakPassword');
        },
      });
      await renderRouter(routes(), { initialUrl: '/sign-up' });

      await user.type(await screen.findByTestId('sign-up-name'), 'Ana');
      await user.type(screen.getByTestId('sign-up-email'), EMAIL);
      await user.type(screen.getByTestId('sign-up-password'), 'password123');
      await press(user, 'sign-up-submit');

      expect(await screen.findByTestId('form-error')).toHaveTextContent(
        'Esa contraseña es fácil de adivinar. Prueba con una más larga.',
      );
    });
  });

  describe('entrar', () => {
    it('con credenciales correctas entra a la app', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService();
      await renderRouter(routes(), { initialUrl: '/' });

      await press(user, 'welcome-sign-in');
      await user.type(await screen.findByTestId('sign-in-email'), EMAIL);
      await user.type(screen.getByTestId('sign-in-password'), PASSWORD);
      await press(user, 'sign-in-submit');

      expect(service.signIn).toHaveBeenCalledWith(EMAIL, PASSWORD);
      expect(await screen.findByTestId('groups-screen')).toBeOnTheScreen();
    });

    it('con credenciales equivocadas muestra un mensaje que no revela la cuenta', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        signIn: async () => {
          throw new AuthError('invalidCredentials');
        },
      });
      await renderRouter(routes(), { initialUrl: '/sign-in' });

      await user.type(await screen.findByTestId('sign-in-email'), EMAIL);
      await user.type(screen.getByTestId('sign-in-password'), 'otra');
      await press(user, 'sign-in-submit');

      expect(await screen.findByTestId('form-error')).toHaveTextContent(
        'Correo o contraseña incorrectos.',
      );
      expect(screen.queryByTestId('sign-in-resend-confirmation')).toBeNull();
    });

    it('con el correo sin confirmar ofrece reenviarlo y lleva a revisar el correo', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        signIn: async () => {
          throw new AuthError('emailNotConfirmed');
        },
      });
      await renderRouter(routes(), { initialUrl: '/sign-in' });

      await user.type(await screen.findByTestId('sign-in-email'), EMAIL);
      await user.type(screen.getByTestId('sign-in-password'), PASSWORD);
      await press(user, 'sign-in-submit');
      expect(await screen.findByTestId('form-error')).toHaveTextContent(
        'Confirma tu correo antes de entrar.',
      );

      await press(user, 'sign-in-resend-confirmation');
      expect(service.resend).toHaveBeenCalledWith(EMAIL, 'signup');
      expect(await screen.findByTestId('check-email-screen')).toBeOnTheScreen();
    });
  });

  describe('recuperar la contraseña', () => {
    it('correo → código → contraseña nueva → la app', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService();
      await renderRouter(routes(), { initialUrl: '/sign-in' });

      await user.type(await screen.findByTestId('sign-in-email'), EMAIL);
      await press(user, 'sign-in-forgot');
      // El correo escrito pasa a la pantalla de recuperar.
      expect(await screen.findByTestId('forgot-password-email')).toHaveDisplayValue(EMAIL);
      await press(user, 'forgot-password-submit');

      expect(service.requestPasswordReset).toHaveBeenCalledWith(EMAIL);
      expect(
        await screen.findByText(/Si existe una cuenta con ana@example\.com/),
      ).toBeOnTheScreen();

      await user.type(screen.getByTestId('check-email-code'), '654321');
      await press(user, 'check-email-submit');
      expect(service.verifyCode).toHaveBeenCalledWith(EMAIL, '654321', 'recovery');

      // Con la sesión de recuperación solo existe la pantalla de la contraseña nueva.
      expect(await screen.findByTestId('reset-password-screen')).toBeOnTheScreen();
      await user.type(screen.getByTestId('reset-password-password'), 'otra contraseña larga');
      await press(user, 'reset-password-submit');

      expect(service.updatePassword).toHaveBeenCalledWith('otra contraseña larga');
      expect(await screen.findByTestId('groups-screen')).toBeOnTheScreen();
    });

    it('el enlace de recuperación del correo lleva a la contraseña nueva', async () => {
      service = createFakeAuthService({
        exchangeCode: async () => ({ session: TEST_SESSION, recovery: true }),
      });
      await renderRouter(routes(), { initialUrl: '/auth/callback?code=abc-123' });

      expect(await screen.findByTestId('reset-password-screen')).toBeOnTheScreen();
      expect(service.exchangeCode).toHaveBeenCalledTimes(1);
      expect(service.exchangeCode).toHaveBeenCalledWith('abc-123', null);
    });

    it('cancelar la contraseña nueva cierra la sesión de recuperación', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        exchangeCode: async () => ({ session: TEST_SESSION, recovery: true }),
      });
      await renderRouter(routes(), { initialUrl: '/auth/callback?code=abc-123' });

      await press(user, 'reset-password-cancel');
      expect(service.signOut).toHaveBeenCalledTimes(1);
      expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
    });
  });

  describe('enlaces del correo', () => {
    it('el enlace de confirmación entra a la app', async () => {
      service = createFakeAuthService();
      await renderRouter(routes(), { initialUrl: '/auth/callback?code=abc-123' });
      expect(await screen.findByTestId('groups-screen')).toBeOnTheScreen();
    });

    it('un enlace vencido explica qué hacer y vuelve a la bienvenida', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        exchangeCode: async () => {
          throw new AuthError('linkExpired');
        },
      });
      await renderRouter(routes(), { initialUrl: '/auth/callback?code=abc-123' });

      expect(await screen.findByTestId('auth-callback-error')).toBeOnTheScreen();
      await user.press(screen.getByRole('button', { name: 'Volver' }));
      expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
    });

    it('un enlace con error de Supabase no intenta canjear nada', async () => {
      service = createFakeAuthService();
      await renderRouter(routes(), {
        initialUrl: '/auth/callback?error=access_denied&error_code=otp_expired',
      });
      expect(await screen.findByTestId('auth-callback-error')).toBeOnTheScreen();
      expect(service.exchangeCode).not.toHaveBeenCalled();
    });
  });

  describe('Google', () => {
    it('sin Google disponible (iOS o sin configurar) no aparece el botón', async () => {
      service = createFakeAuthService();
      await renderRouter(routes(), { initialUrl: '/' });
      expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
      expect(screen.queryByTestId('welcome-google')).toBeNull();
    });

    it('con Google disponible, la bienvenida lo ofrece y entra a la app', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({ canUseGoogle: () => true });
      await renderRouter(routes(), { initialUrl: '/' });

      await user.press(await screen.findByRole('button', { name: 'Continuar con Google' }));
      expect(service.signInWithGoogle).toHaveBeenCalledTimes(1);
      expect(await screen.findByTestId('groups-screen')).toBeOnTheScreen();
    });

    it('cerrar la hoja de Google no muestra ningún error', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        canUseGoogle: () => true,
        signInWithGoogle: async () => null,
      });
      await renderRouter(routes(), { initialUrl: '/sign-in' });

      await press(user, 'sign-in-google');
      expect(service.signInWithGoogle).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('sign-in-screen')).toBeOnTheScreen();
      expect(screen.queryByTestId('form-error')).toBeNull();
    });

    it('sin cuentas de Google explica qué hacer', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        canUseGoogle: () => true,
        signInWithGoogle: async () => {
          throw new AuthError('googleNoAccount');
        },
      });
      await renderRouter(routes(), { initialUrl: '/' });

      await press(user, 'welcome-google');
      expect(await screen.findByTestId('form-error')).toHaveTextContent(
        /No hay cuentas de Google en este teléfono/,
      );
    });
  });

  describe('revisa tu correo', () => {
    it('reenviar espera antes de estar disponible', async () => {
      service = createFakeAuthService();
      await renderRouter(routes(), {
        initialUrl: `/check-email?flow=signup&email=${encodeURIComponent(EMAIL)}`,
      });

      const resend = await screen.findByTestId('check-email-resend');
      expect(resend).toBeDisabled();
      expect(resend).toHaveTextContent(/Reenviar en (60|59) s/);
    });

    it('un código incompleto no se envía', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService();
      await renderRouter(routes(), {
        initialUrl: `/check-email?flow=signup&email=${encodeURIComponent(EMAIL)}`,
      });

      await user.type(await screen.findByTestId('check-email-code'), '12a3');
      expect(screen.getByTestId('check-email-code')).toHaveDisplayValue('123');
      await press(user, 'check-email-submit');
      expect(await screen.findByText('El código tiene 6 dígitos.')).toBeOnTheScreen();
      expect(service.verifyCode).not.toHaveBeenCalled();
    });

    it('sin un correo válido en los parámetros vuelve a la bienvenida', async () => {
      service = createFakeAuthService();
      await renderRouter(routes(), { initialUrl: '/check-email?flow=signup&email=nada' });
      await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    });
  });
});
