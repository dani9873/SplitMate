import { render, userEvent } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

import { deleteAccountData } from '@/db/client';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import { recordConflict } from '@/db/sync/conflicts';
import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { AuthProvider } from '@/features/auth';
import { TEST_SESSION, createFakeAuthService } from '@/features/auth/test-utils';
import { createFakeSyncEngine, type FakeSyncEngine } from '@/features/sync/fake-engine';
import { SyncEngineProvider } from '@/features/sync/SyncProvider';
import { changeLanguage } from '@/i18n';

import { DeleteAccountScreen } from '../DeleteAccountScreen';
import { SignOutSheet } from '../SignOutSheet';

jest.mock('@/db/client', () => ({
  openAccountDatabase: jest.fn(),
  deleteAccountData: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

const UNSYNCED = { state: 'pending', pending: 2, failed: 1, conflicts: 1 } as const;
/** Todo subió; solo queda un borrador por revisar. */
const ONLY_DRAFTS = { state: 'synced', pending: 0, failed: 0, conflicts: 1 } as const;
const DRAFT = '01990000-0000-7000-8000-0000000000c1';

let lastService: ReturnType<typeof createFakeAuthService>;
let ctx: TestRepositories;
let groupId: string;

function Providers({ engine, children }: { engine: FakeSyncEngine; children: ReactNode }) {
  return (
    <AuthProvider service={lastService}>
      <DatabaseProvider value={{ db: ctx.db, repos: ctx.repos, bus: ctx.bus }}>
        <SyncEngineProvider engine={engine}>{children}</SyncEngineProvider>
      </DatabaseProvider>
    </AuthProvider>
  );
}

async function renderSheet(engine: FakeSyncEngine, onClose: () => void = jest.fn()) {
  await render(
    <Providers engine={engine}>
      <SignOutSheet visible onClose={onClose} />
    </Providers>,
  );
}

type User = ReturnType<typeof userEvent.setup>;
const press = async (user: User, testID: string) => user.press(await screen.findByTestId(testID));

beforeEach(async () => {
  mockPush.mockReset();
  ctx = await createTestRepositories();
  const { group } = createTestGroup(ctx);
  groupId = group.id;
  recordConflict(ctx.db, {
    id: DRAFT,
    entity: 'group',
    entityId: groupId,
    groupId,
    reason: 'conflict',
    data: {
      name: 'Playa',
      currency: group.currency,
      emoji: group.emoji,
      color: group.color,
      archived: false,
      deleted: false,
    },
    serverDeleted: false,
    wasNew: false,
    wasDeletion: false,
    createdAt: 1,
  });
  lastService = createFakeAuthService({ restore: async () => TEST_SESSION });
  jest.mocked(deleteAccountData).mockReset().mockResolvedValue(undefined);
  await act(() => changeLanguage('es'));
});

afterAll(async () => {
  await act(() => changeLanguage('en'));
});

describe('cerrar sesión y borrar los datos del teléfono', () => {
  it('con todo en la nube lo dice, y el texto viejo ya no está', async () => {
    const user = userEvent.setup();
    await renderSheet(createFakeSyncEngine());
    await press(user, 'sign-out-wipe');

    expect(await screen.findByText(/están en la nube/)).toBeOnTheScreen();
    expect(screen.queryByText(/todavía no se guardan en la nube/)).toBeNull();
    expect(screen.queryByTestId('unsynced-warning')).toBeNull();
    expect(screen.getByTestId('sign-out-wipe-confirm')).toBeOnTheScreen();
  });

  it('con cambios sin subir los cuenta y ofrece sincronizar, borrar de todos modos y cancelar', async () => {
    const user = userEvent.setup();
    await renderSheet(createFakeSyncEngine(UNSYNCED));
    await press(user, 'sign-out-wipe');

    expect(await screen.findByTestId('unsynced-warning')).toBeOnTheScreen();
    expect(screen.getByText('2 cambios por subir')).toBeOnTheScreen();
    expect(screen.getByText('1 cambio que el servidor no aceptó')).toBeOnTheScreen();
    expect(screen.getByText('1 cambio por revisar')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sincronizar primero' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Borrar de todos modos' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeOnTheScreen();
    expect(screen.queryByTestId('sign-out-wipe-confirm')).toBeNull();
    expect(screen.queryByText(/todavía no se guardan en la nube/)).toBeNull();
  });

  it('"Sincronizar primero": si todo subió, sigue a la confirmación normal', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine(UNSYNCED);
    engine.syncNow.mockImplementation(async () => {
      engine.setStatus({ state: 'synced', pending: 0, failed: 0, conflicts: 0 });
      return engine.getStatus();
    });
    await renderSheet(engine);
    await press(user, 'sign-out-wipe');
    await user.press(await screen.findByRole('button', { name: 'Sincronizar primero' }));

    expect(engine.syncNow).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/están en la nube/)).toBeOnTheScreen();
    expect(screen.queryByTestId('unsynced-warning')).toBeNull();
    expect(screen.getByTestId('sign-out-wipe-confirm')).toBeOnTheScreen();
  });

  it('"Sincronizar primero": si queda algo, vuelve a avisar con los números nuevos y el motivo', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine(UNSYNCED);
    engine.syncNow.mockImplementation(async () => {
      engine.setStatus({
        state: 'offline',
        pending: 1,
        failed: 0,
        conflicts: 0,
        lastError: 'offline',
      });
      return engine.getStatus();
    });
    await renderSheet(engine);
    await press(user, 'sign-out-wipe');
    await user.press(await screen.findByRole('button', { name: 'Sincronizar primero' }));

    expect(await screen.findByText('1 cambio por subir')).toBeOnTheScreen();
    expect(screen.queryByText('2 cambios por subir')).toBeNull();
    expect(screen.getByText('No hay conexión con el servidor.')).toBeOnTheScreen();
    expect(screen.getByTestId('unsynced-warning')).toBeOnTheScreen();
    expect(screen.queryByTestId('sign-out-wipe-confirm')).toBeNull();
  });

  it('"Borrar de todos modos" cierra la sesión y borra los datos del teléfono', async () => {
    const user = userEvent.setup();
    await renderSheet(createFakeSyncEngine(UNSYNCED));
    await press(user, 'sign-out-wipe');
    await user.press(await screen.findByRole('button', { name: 'Borrar de todos modos' }));

    await waitFor(() => expect(lastService.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(deleteAccountData).toHaveBeenCalledWith(TEST_SESSION.userId));
  });

  it('"Cancelar" no cierra la sesión', async () => {
    const user = userEvent.setup();
    await renderSheet(createFakeSyncEngine(UNSYNCED));
    await press(user, 'sign-out-wipe');
    await user.press(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(lastService.signOut).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unsynced-warning')).toBeNull();
    expect(screen.getByTestId('sign-out-keep')).toBeOnTheScreen();
  });

  it('cerrar sesión conservando los datos no estorba con cambios sin subir', async () => {
    const user = userEvent.setup();
    await renderSheet(createFakeSyncEngine(UNSYNCED));
    await press(user, 'sign-out-keep');

    await waitFor(() => expect(lastService.signOut).toHaveBeenCalledTimes(1));
    expect(deleteAccountData).not.toHaveBeenCalled();
  });

  it('con solo borradores no ofrece "Sincronizar primero": ofrece "Revisar" y "Borrar de todos modos"', async () => {
    const user = userEvent.setup();
    await renderSheet(createFakeSyncEngine(ONLY_DRAFTS));
    await press(user, 'sign-out-wipe');

    expect(await screen.findByTestId('unsynced-warning')).toBeOnTheScreen();
    expect(screen.getByText('1 cambio por revisar')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sincronizar primero' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Borrar de todos modos' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeOnTheScreen();
  });

  it('"Revisar" cierra la hoja y lleva al grupo del borrador', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    await renderSheet(createFakeSyncEngine(ONLY_DRAFTS), onClose);
    await press(user, 'sign-out-wipe');
    await user.press(await screen.findByRole('button', { name: 'Revisar' }));

    expect(mockPush).toHaveBeenCalledWith(`/groups/${groupId}`);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(lastService.signOut).not.toHaveBeenCalled();
  });

  it('con cambios por subir y borradores sigue ofreciendo "Sincronizar primero"', async () => {
    const user = userEvent.setup();
    await renderSheet(createFakeSyncEngine({ ...ONLY_DRAFTS, state: 'pending', pending: 1 }));
    await press(user, 'sign-out-wipe');

    expect(await screen.findByRole('button', { name: 'Sincronizar primero' })).toBeOnTheScreen();
  });

  it('habla en inglés', async () => {
    await act(() => changeLanguage('en'));
    const user = userEvent.setup();
    await renderSheet(createFakeSyncEngine(UNSYNCED));
    await press(user, 'sign-out-wipe');

    expect(await screen.findByRole('button', { name: 'Sync first' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Delete anyway' })).toBeOnTheScreen();
  });
});

describe('borrar la cuenta', () => {
  async function renderDelete(engine: FakeSyncEngine) {
    await renderRouter(
      {
        _layout: () => (
          <Providers engine={engine}>
            <Slot />
          </Providers>
        ),
        index: DeleteAccountScreen,
      },
      { initialUrl: '/' },
    );
  }

  it('con todo en la nube no muestra el aviso', async () => {
    await renderDelete(createFakeSyncEngine());
    expect(await screen.findByTestId('delete-account-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('unsynced-warning')).toBeNull();
  });

  it('con cambios sin subir avisa y "Sincronizar primero" llama al motor; borrar sigue disponible', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine(UNSYNCED);
    await renderDelete(engine);

    expect(await screen.findByTestId('unsynced-warning')).toBeOnTheScreen();
    expect(screen.getByText('2 cambios por subir')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sincronizar primero' }));
    expect(engine.syncNow).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('delete-account-submit')).toBeOnTheScreen();
  });

  it('con solo borradores ofrece "Revisar" en lugar de "Sincronizar primero"; borrar sigue disponible', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine(ONLY_DRAFTS);
    await renderDelete(engine);

    expect(await screen.findByTestId('unsynced-warning')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sincronizar primero' })).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Revisar' }));
    expect(mockPush).toHaveBeenCalledWith(`/groups/${groupId}`);
    expect(engine.syncNow).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-account-submit')).toBeOnTheScreen();
  });

  it('el aviso desaparece cuando lo pendiente sube', async () => {
    const engine = createFakeSyncEngine(UNSYNCED);
    await renderDelete(engine);
    expect(await screen.findByTestId('unsynced-warning')).toBeOnTheScreen();

    await act(() => engine.setStatus({ state: 'synced', pending: 0, failed: 0, conflicts: 0 }));
    expect(screen.queryByTestId('unsynced-warning')).toBeNull();
  });
});
