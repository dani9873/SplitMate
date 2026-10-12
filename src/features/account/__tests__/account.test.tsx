import { userEvent } from '@testing-library/react-native';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { deleteAccountData, openAccountDatabase } from '@/db/client';
import { createTestDatabase } from '@/db/test-utils';
import { AuthError, AuthProvider } from '@/features/auth';
import {
  TEST_SESSION,
  createFakeAuthService,
  type FakeAuthService,
} from '@/features/auth/test-utils';
import { RootNavigator } from '@/features/navigation';
import { changeLanguage } from '@/i18n';

import { useAccountNotice } from '../account-notice';

jest.mock('@/db/client', () => ({
  openAccountDatabase: jest.fn(),
  deleteAccountData: jest.fn(),
}));
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
// Teléfono en español: así lo aplican las preferencias al hidratarse.
jest.mock('expo-localization', () => {
  const locales = [{ languageCode: 'es', languageTag: 'es-CO', regionCode: 'CO' }];
  return { getLocales: () => locales, useLocales: () => locales };
});

const route = (path: string) => require(`../../../../app/${path}`).default;

let service: FakeAuthService;
const close = jest.fn();

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
  '(app)/_layout': route('(app)/_layout'),
  '(app)/(tabs)/_layout': route('(app)/(tabs)/_layout'),
  '(app)/(tabs)/index': route('(app)/(tabs)/index'),
  '(app)/(tabs)/activity': route('(app)/(tabs)/activity'),
  '(app)/(tabs)/settings': route('(app)/(tabs)/settings'),
  '(app)/account/delete': route('(app)/account/delete'),
});

type User = ReturnType<typeof userEvent.setup>;

async function press(user: User, testID: string) {
  await user.press(await screen.findByTestId(testID));
}

const PASSWORD = 'una contraseña larga';

describe('cuenta', () => {
  beforeEach(async () => {
    close.mockClear();
    const { db } = await createTestDatabase();
    jest.mocked(openAccountDatabase).mockResolvedValue({ db, close });
    jest.mocked(deleteAccountData).mockReset().mockResolvedValue(undefined);
    useAccountNotice.getState().clear();
    await act(() => changeLanguage('es'));
  });

  afterAll(async () => {
    await act(() => changeLanguage('en'));
  });

  describe('cerrar sesión', () => {
    it('Ajustes muestra la cuenta y cerrar sesión deja los datos en el teléfono', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({ restore: async () => TEST_SESSION });
      await renderRouter(routes(), { initialUrl: '/settings' });

      expect(await screen.findByText('Entraste como ana@example.com')).toBeOnTheScreen();
      await press(user, 'account-sign-out');
      await press(user, 'sign-out-keep');

      expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
      expect(service.signOut).toHaveBeenCalledTimes(1);
      expect(deleteAccountData).not.toHaveBeenCalled();
      expect(screen.queryByTestId('account-notice')).toBeNull();
    });

    it('la segunda opción advierte, cierra la sesión y después borra los datos del teléfono', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({ restore: async () => TEST_SESSION });
      await renderRouter(routes(), { initialUrl: '/settings' });

      await press(user, 'account-sign-out');
      await press(user, 'sign-out-wipe');
      expect(
        await screen.findByText(/todavía no se guardan en la nube: si los borras/),
      ).toBeOnTheScreen();
      await press(user, 'sign-out-wipe-confirm');

      expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
      expect(service.signOut).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(deleteAccountData).toHaveBeenCalledWith(TEST_SESSION.userId));
      expect(await screen.findByTestId('account-notice')).toHaveTextContent(
        /Cerraste sesión y se borraron los datos de este teléfono/,
      );
    });

    it('si borrar los datos falla, el aviso lo dice', async () => {
      const user = userEvent.setup();
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.mocked(deleteAccountData).mockRejectedValue(new Error('base abierta'));
      service = createFakeAuthService({ restore: async () => TEST_SESSION });
      await renderRouter(routes(), { initialUrl: '/settings' });

      await press(user, 'account-sign-out');
      await press(user, 'sign-out-wipe');
      await press(user, 'sign-out-wipe-confirm');

      expect(await screen.findByTestId('account-notice')).toHaveTextContent(
        /no se pudieron borrar los datos de este teléfono/,
      );
    });
  });

  describe('borrar la cuenta', () => {
    it('pide el correo exacto y la contraseña, borra la cuenta y los datos y vuelve a la bienvenida', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({ restore: async () => TEST_SESSION });
      await renderRouter(routes(), { initialUrl: '/settings' });

      await press(user, 'account-delete');
      expect(await screen.findByText('Tu cuenta y tu perfil en SplitMate.')).toBeOnTheScreen();

      await user.type(screen.getByTestId('delete-account-email'), 'otra@example.com');
      await press(user, 'delete-account-submit');
      expect(
        await screen.findByText('No coincide con el correo de esta cuenta.'),
      ).toBeOnTheScreen();
      expect(service.deleteAccount).not.toHaveBeenCalled();

      await user.clear(screen.getByTestId('delete-account-email'));
      await user.type(screen.getByTestId('delete-account-email'), ' ANA@example.com ');
      await user.type(screen.getByTestId('delete-account-password'), PASSWORD);
      await press(user, 'delete-account-submit');

      expect(service.reauthenticateWithPassword).toHaveBeenCalledWith(TEST_SESSION, PASSWORD);
      expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
      expect(service.deleteAccount).toHaveBeenCalledTimes(1);
      expect(service.signOut).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(deleteAccountData).toHaveBeenCalledWith(TEST_SESSION.userId));
      expect(await screen.findByTestId('account-notice')).toHaveTextContent(
        /^Tu cuenta se borró\./,
      );
    });

    it('con una cuenta de Google vuelve a pedir Google en lugar de la contraseña', async () => {
      const user = userEvent.setup();
      const googleSession = { ...TEST_SESSION, providers: ['google'] };
      service = createFakeAuthService({
        restore: async () => googleSession,
        canUseGoogle: () => true,
      });
      await renderRouter(routes(), { initialUrl: '/account/delete' });

      expect(
        await screen.findByText('Para confirmar, vuelve a elegir tu cuenta de Google.'),
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('delete-account-password')).toBeNull();
      await user.type(screen.getByTestId('delete-account-email'), TEST_SESSION.email);
      await press(user, 'delete-account-submit');

      expect(service.reauthenticateWithGoogle).toHaveBeenCalledTimes(1);
      expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
      expect(service.deleteAccount).toHaveBeenCalledTimes(1);
    });

    it('si cierra la hoja de Google, no borra nada', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        restore: async () => ({ ...TEST_SESSION, providers: ['google'] }),
        canUseGoogle: () => true,
        reauthenticateWithGoogle: async () => false,
      });
      await renderRouter(routes(), { initialUrl: '/account/delete' });

      await user.type(await screen.findByTestId('delete-account-email'), TEST_SESSION.email);
      await press(user, 'delete-account-submit');

      expect(service.reauthenticateWithGoogle).toHaveBeenCalledTimes(1);
      expect(service.deleteAccount).not.toHaveBeenCalled();
      expect(screen.getByTestId('delete-account-screen')).toBeOnTheScreen();
    });

    it('si elige otra cuenta de Google, no borra nada y lo explica', async () => {
      const user = userEvent.setup();
      const googleSession = { ...TEST_SESSION, providers: ['google'] };
      service = createFakeAuthService({
        restore: async () => googleSession,
        canUseGoogle: () => true,
        reauthenticateWithGoogle: async () => {
          throw new AuthError('wrongAccount');
        },
      });
      await renderRouter(routes(), { initialUrl: '/account/delete' });

      await user.type(await screen.findByTestId('delete-account-email'), TEST_SESSION.email);
      await press(user, 'delete-account-submit');

      expect(await screen.findByTestId('form-error')).toHaveTextContent(
        'Elegiste otra cuenta. No se borró nada: vuelve a intentarlo con la cuenta de esta sesión.',
      );
      expect(service.reauthenticateWithGoogle).toHaveBeenCalledWith(googleSession);
      expect(service.deleteAccount).not.toHaveBeenCalled();
      expect(service.signOut).not.toHaveBeenCalled();
      expect(deleteAccountData).not.toHaveBeenCalled();
    });

    it('si la Edge Function pide reautenticar, lo explica y no cierra la sesión', async () => {
      const user = userEvent.setup();
      service = createFakeAuthService({
        restore: async () => TEST_SESSION,
        deleteAccount: async () => {
          throw new AuthError('reauthenticationRequired');
        },
      });
      await renderRouter(routes(), { initialUrl: '/account/delete' });

      await user.type(await screen.findByTestId('delete-account-email'), TEST_SESSION.email);
      await user.type(screen.getByTestId('delete-account-password'), PASSWORD);
      await press(user, 'delete-account-submit');

      expect(await screen.findByTestId('form-error')).toHaveTextContent(
        'Por seguridad, vuelve a confirmar que eres tú.',
      );
      expect(service.signOut).not.toHaveBeenCalled();
      expect(deleteAccountData).not.toHaveBeenCalled();
    });
  });
});
