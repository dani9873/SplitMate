import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { AccessError } from '@/features/access';
import { createFakeAccessService, type FakeAccessService } from '@/features/access/fake-access';
import { createFakeSyncEngine, type FakeSyncEngine } from '@/features/sync/fake-engine';
import { changeLanguage } from '@/i18n';
import { renderWithDatabase } from '@/test/render';

import { GroupSettingsScreen } from '../GroupSettingsScreen';

const mockParams: { groupId?: string } = {};
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace }),
}));

const BETO_ACCOUNT = '01990000-0000-7000-8000-0000000000aa';
const NOW = 1_790_000_000_000;

let alertSpy: jest.SpyInstance;

beforeEach(async () => {
  mockReplace.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await act(() => changeLanguage('es'));
});

afterEach(async () => {
  alertSpy.mockRestore();
  await act(() => changeLanguage('en'));
});

/** Los botones del último diálogo; `confirm` pulsa el que tiene ese texto. */
const lastDialog = () => {
  const call = alertSpy.mock.calls.at(-1) as [string, string | undefined, AlertButton[]];
  return { title: call[0], message: call[1], buttons: call[2] };
};
const confirm = async (label: string) => {
  const button = lastDialog().buttons.find((b) => b.text === label);
  expect(button).toBeDefined();
  await act(async () => {
    button?.onPress?.();
  });
};

interface Options {
  role?: 'owner' | 'member';
  lost?: boolean;
  access?: FakeAccessService;
  engine?: FakeSyncEngine;
}

/** Un grupo compartido: yo (Ana) con el rol que se pida, Beto con cuenta y Carla sin ella. */
async function setup({ role = 'owner', lost = false, access, engine }: Options = {}) {
  const ctx: TestRepositories = await createTestRepositories();
  const { group, ids } = createTestGroup(ctx);
  const me = ctx.repos.profile.get()!;
  ctx.sqlite.run(
    `INSERT INTO users (id, created_at, updated_at, display_name, is_remote)
     VALUES ('${BETO_ACCOUNT}', ${NOW}, ${NOW}, '?', 1)`,
  );
  ctx.sqlite.run(
    `UPDATE group_members SET user_id = '${BETO_ACCOUNT}', version = version + 1 WHERE id = '${ids[1]}'`,
  );
  const grant = (id: string, userId: string, accessRole: string) =>
    ctx.sqlite.run(
      `INSERT INTO group_access (id, group_id, user_id, role, created_at, updated_at, version)
       VALUES ('${id}', '${group.id}', '${userId}', '${accessRole}', ${NOW}, ${NOW}, 1)`,
    );
  grant('a-me', me.id, role);
  grant('a-beto', BETO_ACCOUNT, role === 'owner' ? 'member' : 'owner');
  if (lost) {
    ctx.sqlite.run(`UPDATE groups SET access_lost_at = ${NOW} WHERE id = '${group.id}'`);
  }
  mockParams.groupId = group.id;
  const fakeAccess = access ?? createFakeAccessService();
  const fakeEngine = engine ?? createFakeSyncEngine();
  await renderWithDatabase(<GroupSettingsScreen />, ctx, {
    access: fakeAccess,
    engine: fakeEngine,
  });
  await screen.findByTestId('group-settings-screen');
  return { ctx, group, ids, me, access: fakeAccess, engine: fakeEngine };
}

describe('ajustes del grupo: marcas de cada miembro', () => {
  it('marca al dueño, a quien tiene cuenta y a "tú"', async () => {
    await setup();
    expect(await screen.findByText('Ana (tú)')).toBeOnTheScreen();
    expect(screen.getByText('Dueño')).toBeOnTheScreen();
    expect(screen.getByText('Con cuenta')).toBeOnTheScreen();
    // Carla no tiene cuenta: sin marca.
    expect(screen.getAllByText('Con cuenta')).toHaveLength(1);
  });

  it('si el dueño es otra persona, la marca va con ella', async () => {
    await setup({ role: 'member' });
    expect(await screen.findByText('Dueño · Con cuenta')).toBeOnTheScreen();
  });

  it('en inglés, con sus textos', async () => {
    await act(() => changeLanguage('en'));
    await setup();
    expect(await screen.findByText('Owner')).toBeOnTheScreen();
    expect(screen.getByText('Has account')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: "Remove Beto's access" })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Leave group' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Delete group' })).toBeOnTheScreen();
  });
});

describe('ajustes del grupo: quitar acceso', () => {
  it('el dueño ve "Quitar acceso" en quien tiene cuenta y la papelera en quien no', async () => {
    await setup();
    expect(
      await screen.findByRole('button', { name: 'Quitar el acceso de Beto' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Quitar a Beto' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quitar a Carla' })).toBeOnTheScreen();
    // A sí mismo no: para eso está "Salir del grupo".
    expect(screen.queryByRole('button', { name: 'Quitar el acceso de Ana' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar a Ana' })).toBeNull();
  });

  it('quien no es dueño no puede quitar el acceso ni borrar a nadie con cuenta', async () => {
    await setup({ role: 'member' });
    await screen.findByText('Dueño · Con cuenta');
    expect(screen.queryByRole('button', { name: 'Quitar el acceso de Beto' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar a Beto' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quitar a Carla' })).toBeOnTheScreen();
  });

  it('pide confirmación, llama al servidor y pide un ciclo de sincronización', async () => {
    const user = userEvent.setup();
    const { group, access, engine } = await setup();
    await user.press(await screen.findByRole('button', { name: 'Quitar el acceso de Beto' }));

    const dialog = lastDialog();
    expect(dialog.title).toBe('¿Quitar el acceso de Beto?');
    expect(dialog.message).toMatch(/sus movimientos se conservan/i);
    expect(access.removeAccess).not.toHaveBeenCalled();

    await confirm('Quitar acceso');

    await waitFor(() => expect(access.removeAccess).toHaveBeenCalledWith(group.id, BETO_ACCOUNT));
    await waitFor(() => expect(engine.request).toHaveBeenCalledWith('manual'));
  });

  it('sin internet explica que hace falta y no pide ciclo', async () => {
    const user = userEvent.setup();
    const access = createFakeAccessService({
      removeAccess: jest.fn().mockRejectedValue(new AccessError('OFFLINE')),
    });
    const { engine } = await setup({ access });
    await user.press(await screen.findByRole('button', { name: 'Quitar el acceso de Beto' }));
    await confirm('Quitar acceso');

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(2));
    expect(lastDialog().message).toBe(
      'Hace falta conexión a internet para esto. Inténtalo de nuevo cuando vuelva.',
    );
    expect(engine.request).not.toHaveBeenCalled();
  });

  it('si el servidor no lo permite, lo dice', async () => {
    const user = userEvent.setup();
    const access = createFakeAccessService({
      removeAccess: jest.fn().mockRejectedValue(new AccessError('FORBIDDEN')),
    });
    await setup({ access });
    await user.press(await screen.findByRole('button', { name: 'Quitar el acceso de Beto' }));
    await confirm('Quitar acceso');
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(2));
    expect(lastDialog().message).toBe('Solo el dueño del grupo puede hacer esto.');
  });
});

describe('ajustes del grupo: salir y borrar', () => {
  it('el dueño ve Salir del grupo y Borrar grupo; quien no lo es, solo Salir', async () => {
    await setup();
    expect(await screen.findByTestId('leave-group')).toBeOnTheScreen();
    expect(screen.getByTestId('delete-group')).toBeOnTheScreen();
  });

  it('un miembro que no es dueño no ve Borrar grupo', async () => {
    await setup({ role: 'member' });
    expect(await screen.findByTestId('leave-group')).toBeOnTheScreen();
    expect(screen.queryByTestId('delete-group')).toBeNull();
  });

  it('salir: confirma, llama al servidor, pide un ciclo y vuelve al inicio', async () => {
    const user = userEvent.setup();
    const { group, access, engine } = await setup({ role: 'member' });
    await user.press(await screen.findByTestId('leave-group'));
    expect(lastDialog().title).toBe('¿Salir de Viaje?');

    await confirm('Salir');

    await waitFor(() => expect(access.leaveGroup).toHaveBeenCalledWith(group.id));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(engine.request).toHaveBeenCalledWith('manual');
  });

  it('si eres la única persona con acceso, no sales: te lo explica', async () => {
    const user = userEvent.setup();
    const access = createFakeAccessService({
      leaveGroup: jest.fn().mockRejectedValue(new AccessError('LAST_ACCOUNT')),
    });
    await setup({ access });
    await user.press(await screen.findByTestId('leave-group'));
    await confirm('Salir');
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(2));
    expect(lastDialog().message).toBe('Eres la única persona con acceso. Puedes borrar el grupo.');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('salir sin internet: lo dice y se queda', async () => {
    const user = userEvent.setup();
    const access = createFakeAccessService({
      leaveGroup: jest.fn().mockRejectedValue(new AccessError('OFFLINE')),
    });
    await setup({ role: 'member', access });
    await user.press(await screen.findByTestId('leave-group'));
    await confirm('Salir');
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(2));
    expect(lastDialog().message).toMatch(/Hace falta conexión a internet/);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('borrar el grupo: confirma, lo borra (borrado lógico) y vuelve al inicio', async () => {
    const user = userEvent.setup();
    const { ctx, group } = await setup();
    await user.press(await screen.findByTestId('delete-group'));
    expect(lastDialog().title).toBe('¿Borrar Viaje?');

    await confirm('Borrar grupo');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(ctx.repos.groups.get(group.id)).toBeUndefined();
  });
});

describe('ajustes de un grupo sin acceso', () => {
  it('muestra el aviso y deja todo de solo lectura', async () => {
    await setup({ lost: true });
    expect(await screen.findByTestId('access-lost-banner')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Ya no tienes acceso a este grupo. Esta es la última copia de este teléfono.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('leave-group')).toBeNull();
    expect(screen.queryByTestId('delete-group')).toBeNull();
    expect(screen.queryByTestId('archive-group')).toBeNull();
    expect(screen.queryByTestId('add-member')).toBeNull();
    expect(screen.queryByTestId('save-group')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar el acceso de Beto' })).toBeNull();
    // Los datos siguen a la vista.
    expect(screen.getAllByText('Carla').length).toBeGreaterThan(0);
  });
});
