import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { changeLanguage } from '@/i18n';
import { renderWithDatabase } from '@/test/render';

import { UndoProvider } from '../../undo';
import { GroupDetailScreen } from '../GroupDetailScreen';

const mockParams: { groupId?: string } = {};
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: mockReplace }),
}));

const NOW = 1_790_000_000_000;
let alertSpy: jest.SpyInstance;

beforeEach(async () => {
  mockReplace.mockClear();
  mockPush.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await act(() => changeLanguage('es'));
});

afterEach(async () => {
  alertSpy.mockRestore();
  await act(() => changeLanguage('en'));
});

const lastDialog = () => {
  const call = alertSpy.mock.calls.at(-1) as [string, string | undefined, AlertButton[]];
  return { title: call[0], message: call[1], buttons: call[2] };
};

async function setup(options: { lost?: boolean; pendingEdit?: boolean } = {}) {
  const ctx: TestRepositories = await createTestRepositories();
  const { group, ids } = createTestGroup(ctx);
  ctx.repos.expenses.add({
    groupId: group.id,
    title: 'Cena',
    amount: 3000,
    currency: 'USD',
    payers: [{ memberId: ids[0] as string, amount: 3000 }],
    split: { method: 'equal', participants: [ids[0] as string, ids[1] as string] },
    occurredOn: '2026-10-09',
  });
  // Todo subido: nada pendiente, salvo lo que cada prueba pida.
  for (const table of ['groups', 'group_members', 'expenses', 'expense_payers', 'expense_splits']) {
    ctx.sqlite.run(`UPDATE ${table} SET synced_version = version, server_version = version`);
  }
  if (options.pendingEdit) {
    ctx.sqlite.run(`UPDATE expenses SET title = 'Cena editada', version = version + 1`);
  }
  if (options.lost) {
    ctx.sqlite.run(`UPDATE groups SET access_lost_at = ${NOW} WHERE id = '${group.id}'`);
  }
  mockParams.groupId = group.id;
  await renderWithDatabase(
    <UndoProvider>
      <GroupDetailScreen />
    </UndoProvider>,
    ctx,
  );
  await screen.findByTestId('group-detail-screen');
  return { ctx, group };
}

describe('detalle de un grupo sin acceso', () => {
  it('con acceso no hay aviso y se puede agregar un movimiento', async () => {
    await setup();
    await screen.findByText('Viaje');
    expect(screen.queryByTestId('access-lost-banner')).toBeNull();
    expect(screen.getByTestId('add-entry')).toBeOnTheScreen();
  });

  it('sin acceso: avisa que es la última copia, no deja agregar y ofrece quitarlo del teléfono', async () => {
    await setup({ lost: true });
    expect(await screen.findByTestId('access-lost-banner')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Ya no tienes acceso a este grupo. Esta es la última copia de este teléfono.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('add-entry')).toBeNull();
    expect(screen.getByRole('button', { name: 'Quitar de este teléfono' })).toBeOnTheScreen();
    // Lo que había sigue a la vista.
    expect(screen.getByText('Cena')).toBeOnTheScreen();
  });

  it('en inglés', async () => {
    await act(() => changeLanguage('en'));
    await setup({ lost: true });
    expect(
      await screen.findByText(
        'You no longer have access to this group. This is the last copy on this phone.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Remove from this phone' })).toBeOnTheScreen();
  });

  it('quitar del teléfono: pide confirmación, borra la copia y vuelve al inicio', async () => {
    const user = userEvent.setup();
    const { ctx, group } = await setup({ lost: true });
    await user.press(await screen.findByRole('button', { name: 'Quitar de este teléfono' }));

    expect(lastDialog().title).toBe('¿Quitar Viaje de este teléfono?');
    expect(lastDialog().message).toBe(
      'Se borra la copia de este grupo que hay en este teléfono. No se puede deshacer.',
    );
    expect(ctx.repos.groups.get(group.id)).toBeDefined();

    await act(async () => {
      lastDialog()
        .buttons.find((b) => b.text === 'Quitar')
        ?.onPress?.();
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(ctx.repos.groups.get(group.id)).toBeUndefined();
  });

  it('cancelar no borra nada', async () => {
    const user = userEvent.setup();
    const { ctx, group } = await setup({ lost: true });
    await user.press(await screen.findByRole('button', { name: 'Quitar de este teléfono' }));
    const cancel = lastDialog().buttons.find((b) => b.text === 'Cancelar');
    expect(cancel?.style).toBe('cancel');
    expect(ctx.repos.groups.get(group.id)).toBeDefined();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('si había cambios sin subir, la pregunta dice cuántos se pierden', async () => {
    const user = userEvent.setup();
    await setup({ lost: true, pendingEdit: true });
    await user.press(await screen.findByRole('button', { name: 'Quitar de este teléfono' }));
    expect(lastDialog().message).toContain('Además se pierde 1 cambio que no se subió.');
  });
});

describe('detalle del grupo: Invitar', () => {
  it('con acceso hay un botón Invitar que lleva a la pantalla de enlaces', async () => {
    const user = userEvent.setup();
    const { group } = await setup();
    await user.press(await screen.findByRole('button', { name: 'Invitar' }));
    expect(mockPush).toHaveBeenCalledWith(`/groups/${group.id}/invite`);
  });

  it('sin acceso no se puede invitar', async () => {
    await setup({ lost: true });
    await screen.findByTestId('access-lost-banner');
    expect(screen.queryByRole('button', { name: 'Invitar' })).toBeNull();
  });

  it('en inglés', async () => {
    await act(() => changeLanguage('en'));
    await setup();
    expect(await screen.findByRole('button', { name: 'Invite' })).toBeOnTheScreen();
  });
});
