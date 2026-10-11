import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { openAccountDatabase } from '@/db/client';
import { createTestDatabase } from '@/db/test-utils';
import { AuthProvider } from '@/features/auth';
import {
  TEST_SESSION,
  createFakeAuthService,
  type FakeAuthService,
} from '@/features/auth/test-utils';
import { changeLanguage } from '@/i18n';

import { RootNavigator } from '../RootNavigator';

// La base de la cuenta es sql.js; el reloj y los ids, deterministas.
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
  '(app)/_layout': route('(app)/_layout'),
  '(app)/(tabs)/_layout': route('(app)/(tabs)/_layout'),
  '(app)/(tabs)/index': route('(app)/(tabs)/index'),
  '(app)/(tabs)/activity': route('(app)/(tabs)/activity'),
  '(app)/(tabs)/settings': route('(app)/(tabs)/settings'),
  '(app)/groups/new': route('(app)/groups/new'),
  '(app)/groups/[groupId]/entries/new': route('(app)/groups/[groupId]/entries/new'),
  '(app)/groups/[groupId]/entries/[entryId]/edit': route(
    '(app)/groups/[groupId]/entries/[entryId]/edit',
  ),
  '(auth)/_layout': route('(auth)/_layout'),
  '(auth)/welcome': route('(auth)/welcome'),
  '+not-found': route('+not-found'),
});

const close = jest.fn();

describe('rutas según la sesión', () => {
  beforeEach(async () => {
    close.mockClear();
    const { db } = await createTestDatabase();
    jest.mocked(openAccountDatabase).mockReset().mockResolvedValue({ db, close });
    await act(() => changeLanguage('es'));
  });

  it('sin sesión, el inicio lleva a la bienvenida y no abre ninguna base', async () => {
    service = createFakeAuthService();
    await renderRouter(routes(), { initialUrl: '/' });

    expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('groups-screen')).toBeNull();
    expect(openAccountDatabase).not.toHaveBeenCalled();
  });

  it('con sesión, abre la base de la cuenta y muestra sus grupos', async () => {
    service = createFakeAuthService({ restore: async () => TEST_SESSION });
    await renderRouter(routes(), { initialUrl: '/' });

    expect(await screen.findByTestId('groups-screen')).toBeOnTheScreen();
    expect(openAccountDatabase).toHaveBeenCalledWith({
      userId: TEST_SESSION.userId,
      email: TEST_SESSION.email,
      displayName: TEST_SESSION.displayName,
    });
  });

  it('con sesión, la bienvenida no está disponible', async () => {
    service = createFakeAuthService({ restore: async () => TEST_SESSION });
    await renderRouter(routes(), { initialUrl: '/welcome' });

    expect(await screen.findByTestId('groups-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('welcome-screen')).toBeNull();
  });

  it('al cerrarse la sesión vuelve a la bienvenida y cierra la base de la cuenta', async () => {
    service = createFakeAuthService({ restore: async () => TEST_SESSION });
    await renderRouter(routes(), { initialUrl: '/' });
    expect(await screen.findByTestId('groups-screen')).toBeOnTheScreen();
    expect(close).not.toHaveBeenCalled();

    await act(async () => service.emitSignedOut());
    expect(await screen.findByTestId('welcome-screen')).toBeOnTheScreen();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
});
