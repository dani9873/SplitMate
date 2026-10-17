import { useState } from 'react';
import { fireEvent, userEvent } from '@testing-library/react-native';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';

import { openAccountDatabase } from '@/db/client';
import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { AuthProvider } from '@/features/auth';
import { TEST_SESSION, createFakeAuthService } from '@/features/auth/test-utils';
import { RootNavigator } from '@/features/navigation';
import { changeLanguage } from '@/i18n';

// Un doble toque llega antes de que React redibuje o de que la navegación termine. Estas pruebas
// disparan dos toques en el mismo `act` para imitarlo: nunca debe haber dos registros ni dos
// pantallas.

const route = (path: string) => require(`../../../app/${path}`).default;

jest.mock('@/db/client', () => ({ openAccountDatabase: jest.fn() }));
jest.setTimeout(60_000);

let ctx: TestRepositories;

function TestRoot() {
  const [service] = useState(() => createFakeAuthService({ restore: async () => TEST_SESSION }));
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
  '(app)/groups/new': route('(app)/groups/new'),
  '(app)/groups/[groupId]/index': route('(app)/groups/[groupId]/index'),
  '(app)/groups/[groupId]/settings': route('(app)/groups/[groupId]/settings'),
  '(app)/groups/[groupId]/entries/new': route('(app)/groups/[groupId]/entries/new'),
});

type User = ReturnType<typeof userEvent.setup>;

async function typeAmount(user: User, text: string) {
  for (const char of text) {
    await user.press(await screen.findByTestId(`keypad-${char}`));
  }
}

/** Dos toques seguidos sobre el mismo botón, sin dejar que React redibuje entre uno y otro. */
async function doubleTap(testID: string) {
  const button = await screen.findByTestId(testID);
  await act(async () => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
}

describe('toques repetidos', () => {
  beforeEach(async () => {
    ctx = await createTestRepositories();
    jest.mocked(openAccountDatabase).mockResolvedValue({ db: ctx.db, close: jest.fn() });
    await act(() => changeLanguage('es'));
  });

  afterAll(async () => {
    await act(() => changeLanguage('en'));
  });

  it('un doble toque en "Crear grupo" crea un solo grupo', async () => {
    const user = userEvent.setup();
    await renderRouter(routes(), { initialUrl: '/groups/new' });
    await screen.findByTestId('create-group-screen');
    await user.type(screen.getByTestId('group-name'), 'Viaje');
    await user.type(screen.getByTestId('your-name'), 'Ana');
    await user.type(screen.getByTestId('member-name-0'), 'Beto');

    await doubleTap('create-group');
    await screen.findByTestId('group-detail-screen');

    expect(ctx.repos.groups.list()).toHaveLength(1);
  });

  it('un doble toque en "Guardar" crea un solo gasto', async () => {
    const user = userEvent.setup();
    const { group } = createTestGroup(ctx);
    await renderRouter(routes(), { initialUrl: `/groups/${group.id}` });
    await user.press(await screen.findByTestId('add-entry'));
    await screen.findByTestId('entry-form-screen');
    await typeAmount(user, '90');
    await user.press(screen.getByTestId('keypad-done'));
    await user.type(screen.getByTestId('entry-title'), 'Hotel');

    await doubleTap('save-entry');
    await screen.findByTestId('group-detail-screen');

    expect(ctx.repos.activity.list({ groupId: group.id })).toHaveLength(1);
  });

  it('un doble toque en "Guardar" crea una sola transferencia', async () => {
    const user = userEvent.setup();
    const { group } = createTestGroup(ctx);
    await renderRouter(routes(), { initialUrl: `/groups/${group.id}` });
    await user.press(await screen.findByTestId('add-entry'));
    await screen.findByTestId('entry-form-screen');
    await user.press(screen.getByTestId('type-transfer'));
    await typeAmount(user, '25');
    await user.press(screen.getByTestId('keypad-done'));

    await doubleTap('save-entry');
    await screen.findByTestId('group-detail-screen');

    expect(ctx.repos.activity.list({ groupId: group.id })).toHaveLength(1);
  });

  it('un doble toque en "Agregar" miembro agrega una sola persona', async () => {
    const user = userEvent.setup();
    const { group } = createTestGroup(ctx);
    await renderRouter(routes(), { initialUrl: `/groups/${group.id}/settings` });
    await user.type(await screen.findByTestId('new-member-name'), 'Diego');

    await doubleTap('add-member');

    const names = ctx.repos.members.listByGroup(group.id).map((m) => m.displayName);
    expect(names.filter((name) => name === 'Diego')).toHaveLength(1);
  });

  it('un doble toque en "Nuevo gasto" abre un solo formulario', async () => {
    const { group } = createTestGroup(ctx);
    await renderRouter(routes(), { initialUrl: `/groups/${group.id}` });

    await doubleTap('add-entry');
    await screen.findByTestId('entry-form-screen');
    await act(() => router.back());

    // Con dos formularios apilados, volver dejaría el segundo a la vista.
    expect(screen.queryByTestId('entry-form-screen')).toBeNull();
    expect(screen.getByTestId('group-detail-screen')).toBeOnTheScreen();
  });

  it('un doble toque en "Cargar datos de ejemplo" los carga una sola vez', async () => {
    await renderRouter(routes(), { initialUrl: '/settings' });
    const button = await screen.findByRole('button', {
      name: /Load sample data|Cargar datos de ejemplo/,
    });

    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    // La carga crea tres grupos de ejemplo; dos cargas darían seis.
    expect(ctx.repos.groups.list()).toHaveLength(3);
  });
});
