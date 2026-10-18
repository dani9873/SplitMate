/** @jest-environment node */
import { act, render, screen, userEvent } from '@testing-library/react-native';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { changeLanguage } from '@/i18n';
import { waitForPressCooldown } from '@/test/press-cooldown';
import { createSupabaseTestServer, type SupabaseTestServer } from '@/test/supabase-pglite';

import { createSyncEngine, type NetworkMonitor } from '../engine';
import { SyncNotices } from '../SyncNotices';
import { SyncProvider } from '../SyncProvider';
import { SyncStatusButton } from '../SyncStatusButton';
import { createDevice, serverSnapshot, type Device } from '../test-utils';

/**
 * Flujo de punta a punta con el motor REAL (no el falso de jest.setup.ts): una base SQLite real,
 * el servidor de prueba (PGlite con las migraciones reales), la red a mano y la interfaz de verdad.
 */

jest.setTimeout(60_000);

let server: SupabaseTestServer;

beforeAll(async () => {
  server = await createSupabaseTestServer();
}, 90_000);

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await act(() => changeLanguage('es'));
});

afterAll(async () => {
  await act(() => changeLanguage('en'));
});

function controllableNetwork(initial: boolean) {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  const monitor: NetworkMonitor = {
    current: () => Promise.resolve(online),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    monitor,
    set(value: boolean) {
      online = value;
      listeners.forEach((listener) => listener(value));
    },
  };
}

/** Monta el indicador de este dispositivo con su motor real. */
async function renderPhone(device: Device, network: NetworkMonitor) {
  await render(
    <DatabaseProvider value={{ db: device.db, repos: device.repos, bus: device.bus }}>
      <SyncProvider
        ensureProfile={async () => 'synced'}
        createEngine={() =>
          createSyncEngine({
            store: device.store,
            remote: device.remote,
            changes: device.bus,
            network,
            ensureProfile: async () => 'synced',
            scheduler: {
              now: () => Date.now(),
              setTimeout: (fn, ms) => setTimeout(fn, ms),
              clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
            },
            random: Math.random,
            // Esperas largas: lo que sube al volver la red solo puede venir del disparo `reconnect`.
            options: { debounceMs: 600_000, maxWaitMs: 600_000 },
          })
        }
      >
        <SyncStatusButton />
        <SyncNotices />
      </SyncProvider>
    </DatabaseProvider>,
  );
}

const indicator = (label: string) =>
  screen.findByLabelText(label, { includeHiddenElements: true }, { timeout: 15_000 });

function addDinner(device: Device, groupId: string, ids: readonly string[], title = 'Cena') {
  return device.repos.expenses.add({
    groupId,
    title,
    amount: 3000,
    currency: 'USD',
    payers: [{ memberId: ids[0] as string, amount: 3000 }],
    split: { method: 'equal', participants: [ids[0] as string, ids[1] as string] },
    occurredOn: '2026-10-09',
  });
}

function editDinner(
  device: Device,
  expenseId: string,
  groupId: string,
  ids: readonly string[],
  title: string,
) {
  const current = device.repos.expenses.get(expenseId)!;
  return device.repos.expenses.update(expenseId, current.version, {
    groupId,
    title,
    amount: 3000,
    currency: 'USD',
    payers: [{ memberId: ids[0] as string, amount: 3000 }],
    split: { method: 'equal', participants: [ids[0] as string, ids[1] as string] },
    occurredOn: '2026-10-09',
  });
}

describe('flujo de sincronización con el motor real', () => {
  it('escribe sin conexión, al volver la red sube todo y el indicador pasa a "al día"', async () => {
    const user = userEvent.setup();
    const userId = await server.createUser('Ana');
    const phone = await createDevice(server, userId);
    const network = controllableNetwork(false);
    await renderPhone(phone, network.monitor);

    expect(await indicator('Sincronización: sin conexión')).toBeOnTheScreen();

    let groupId = '';
    await act(async () => {
      const { group, memberIds } = phone.createGroup();
      groupId = group.id;
      addDinner(phone, group.id, memberIds);
    });
    // Sin red no se llama al servidor: nada llegó.
    expect(await serverSnapshot(server, [groupId])).toMatchObject({ groups: [], expenses: [] });

    await user.press(screen.getByTestId('sync-status-button'));
    expect(await screen.findByText(/cambios por subir/)).toBeOnTheScreen();

    await act(async () => {
      network.set(true);
    });
    expect(await indicator('Sincronización: todo al día')).toBeOnTheScreen();
    expect(await screen.findByText('Todo al día')).toBeOnTheScreen();
    expect(screen.queryByText(/cambios por subir/)).toBeNull();

    const remote = await serverSnapshot(server, [groupId]);
    expect(remote.expenses).toHaveLength(1);
    expect(remote).toEqual(await phone.snapshot());
  });

  it('un conflicto con otro dispositivo queda como borrador por revisar', async () => {
    const user = userEvent.setup();
    const userId = await server.createUser('Beto');
    const phone = await createDevice(server, userId);
    const tablet = await createDevice(server, userId);
    const { group, memberIds } = phone.createGroup();
    const expense = addDinner(phone, group.id, memberIds);
    await phone.sync();
    await tablet.sync();

    // La tablet edita y sube primero; el teléfono edita lo mismo sin conexión.
    editDinner(tablet, expense.id, group.id, memberIds, 'Cena de la tablet');
    await tablet.sync();

    const network = controllableNetwork(false);
    await renderPhone(phone, network.monitor);
    await act(async () => {
      editDinner(phone, expense.id, group.id, memberIds, 'Cena del teléfono');
    });

    await act(async () => {
      network.set(true);
    });
    expect(await indicator('Sincronización: todo al día')).toBeOnTheScreen();

    // El servidor no se pisa, el teléfono vuelve a su versión y lo del usuario queda en un borrador.
    expect((await serverSnapshot(server, [group.id])).expenses[0]).toMatchObject({
      title: 'Cena de la tablet',
    });
    expect(phone.repos.expenses.get(expense.id)?.title).toBe('Cena de la tablet');
    const drafts = phone.store.listConflicts(group.id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      entity: 'expense',
      entityId: expense.id,
      reason: 'conflict',
    });
    expect(drafts[0]?.data).toMatchObject({ title: 'Cena del teléfono' });

    // El motor real avisa del conflicto con su Toast, con el nombre del movimiento.
    expect(await screen.findByText(/cambió en otro dispositivo/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Revisar' })).toBeOnTheScreen();

    await user.press(screen.getByTestId('sync-status-button'));
    expect(await screen.findByText('1 cambio por revisar')).toBeOnTheScreen();
  });

  it('con un borrador por revisar, "Sincronizar ahora" no inventa cambios por subir ni dice que todo está en la nube', async () => {
    const user = userEvent.setup();
    const userId = await server.createUser('Carla');
    const phone = await createDevice(server, userId);
    const tablet = await createDevice(server, userId);
    const { group, memberIds } = phone.createGroup();
    const expense = addDinner(phone, group.id, memberIds);
    await phone.sync();
    await tablet.sync();
    editDinner(tablet, expense.id, group.id, memberIds, 'Cena de la tablet');
    await tablet.sync();

    const network = controllableNetwork(false);
    await renderPhone(phone, network.monitor);
    await act(async () => {
      editDinner(phone, expense.id, group.id, memberIds, 'Cena del teléfono');
    });
    await act(async () => {
      network.set(true);
    });
    expect(await indicator('Sincronización: todo al día')).toBeOnTheScreen();
    expect(phone.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 1, lost: 0 });

    await user.press(screen.getByTestId('sync-status-button'));
    expect(await screen.findByText('1 cambio por revisar')).toBeOnTheScreen();

    // Dos toques a "Sincronizar ahora": el borrador no cuenta como un cambio por subir.
    await user.press(screen.getByRole('button', { name: 'Sincronizar ahora' }));
    // El botón se reemplaza mientras sincroniza: se espera a que vuelva (en CI, más rápido o más
    // lento que en local, el segundo toque llegaba con el botón ausente).
    await user.press(await screen.findByRole('button', { name: 'Sincronizar ahora' }));
    expect(await screen.findByRole('button', { name: 'Sincronizar ahora' })).toBeOnTheScreen();
    expect(phone.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 1, lost: 0 });
    expect(screen.queryByText(/por subir/)).toBeNull();

    // También cuando la tablet vuelve a cambiar lo mismo y el teléfono la descarga.
    editDinner(tablet, expense.id, group.id, memberIds, 'Cena de la tablet, otra vez');
    await tablet.sync();
    await waitForPressCooldown();
    await user.press(screen.getByRole('button', { name: 'Sincronizar ahora' }));
    expect(await screen.findByRole('button', { name: 'Sincronizar ahora' })).toBeOnTheScreen();
    expect(phone.repos.expenses.get(expense.id)?.title).toBe('Cena de la tablet, otra vez');
    expect(phone.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 1, lost: 0 });
    expect(screen.queryByText(/por subir/)).toBeNull();

    // La cabecera no afirma que todo está en la nube mientras haya un borrador solo en el teléfono.
    expect(screen.queryByText('Todo al día')).toBeNull();
    expect(screen.queryByText('Tus cambios están guardados en la nube.')).toBeNull();
    expect(screen.getByText('Al día, con borradores por revisar')).toBeOnTheScreen();
  });
});
