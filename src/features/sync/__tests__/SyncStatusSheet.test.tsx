import { act, render, screen, userEvent } from '@testing-library/react-native';

import { changeLanguage } from '@/i18n';

import { createFakeSyncEngine, type FakeSyncEngine } from '../fake-engine';
import { SyncEngineProvider } from '../SyncProvider';
import { SyncStatusSheet } from '../SyncStatusSheet';

async function renderSheet(engine: FakeSyncEngine) {
  await render(
    <SyncEngineProvider engine={engine}>
      <SyncStatusSheet visible onClose={jest.fn()} />
    </SyncEngineProvider>,
  );
}

beforeEach(async () => {
  await act(() => changeLanguage('es'));
});

afterAll(async () => {
  await act(() => changeLanguage('en'));
});

describe('SyncStatusSheet', () => {
  it('al día: lo dice y no muestra filas de problemas ni "Reintentar"', async () => {
    await renderSheet(createFakeSyncEngine({ lastSyncedAt: Date.UTC(2026, 9, 16, 15, 30) }));
    expect(screen.getByText('Todo al día')).toBeOnTheScreen();
    expect(screen.queryByText(/por subir/)).toBeNull();
    expect(screen.queryByText(/apartado/)).toBeNull();
    expect(screen.queryByText(/por revisar/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    // La fecha sale de Intl y lleva el año.
    expect(screen.getByText(/Última sincronización: .*2026/)).toBeOnTheScreen();
  });

  it('nunca sincronizado: lo dice sin inventar una fecha', async () => {
    await renderSheet(createFakeSyncEngine());
    expect(screen.getByText('Todavía no se ha sincronizado')).toBeOnTheScreen();
  });

  it('explica cada cuenta en lenguaje simple, con singular y plural', async () => {
    await renderSheet(
      createFakeSyncEngine({
        state: 'error',
        pending: 1,
        failed: 2,
        conflicts: 3,
        held: 1,
      }),
    );
    expect(screen.getByText('1 cambio por subir')).toBeOnTheScreen();
    expect(screen.getByText('2 cambios que el servidor no aceptó')).toBeOnTheScreen();
    expect(screen.getByText(/siguen en este teléfono/)).toBeOnTheScreen();
    expect(screen.getByText('3 cambios por revisar')).toBeOnTheScreen();
    expect(screen.getByText(/quedó guardada como borrador/)).toBeOnTheScreen();
    expect(screen.getByText('1 grupo con datos que no se pudieron guardar')).toBeOnTheScreen();
    expect(screen.getByText(/Reintentar vuelve a probar/)).toBeOnTheScreen();
  });

  it('sin conexión explica que se puede seguir usando la app', async () => {
    await renderSheet(createFakeSyncEngine({ state: 'offline', pending: 2 }));
    expect(screen.getByText('Sin conexión')).toBeOnTheScreen();
    expect(screen.getByText(/Puedes seguir usando la app/)).toBeOnTheScreen();
  });

  it.each([
    ['offline', 'No hay conexión con el servidor.'],
    ['timeout', 'El servidor tardó demasiado en responder.'],
    ['server', 'El servidor tuvo un problema.'],
    ['auth', 'Tu sesión ya no es válida. Cierra sesión y vuelve a entrar.'],
    ['protocol', 'El servidor no entendió el último envío.'],
  ] as const)('muestra el último error "%s" sin jerga técnica', async (lastError, text) => {
    await renderSheet(createFakeSyncEngine({ state: 'error', lastError }));
    expect(screen.getByText(text)).toBeOnTheScreen();
  });

  it('"Sincronizar ahora" llama al motor', async () => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine({ state: 'pending', pending: 1 });
    await renderSheet(engine);
    await user.press(screen.getByRole('button', { name: 'Sincronizar ahora' }));
    expect(engine.syncNow).toHaveBeenCalledTimes(1);
  });

  it('mientras sincroniza, el botón está ocupado y no se puede volver a tocar', async () => {
    const engine = createFakeSyncEngine({ state: 'pending', pending: 1, syncing: true });
    await renderSheet(engine);
    const button = screen.getByRole('button', { name: 'Sincronizando…' });
    expect(button).toBeDisabled();
  });

  it.each([
    ['apartados', { state: 'error', failed: 1 }],
    ['grupos retenidos', { state: 'error', held: 1 }],
    ['un fallo del servidor', { state: 'pending', lastError: 'server' }],
  ] as const)('"Reintentar" aparece con %s y llama a retryFailed', async (_name, patch) => {
    const user = userEvent.setup();
    const engine = createFakeSyncEngine(patch);
    await renderSheet(engine);
    await user.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(engine.retryFailed).toHaveBeenCalledTimes(1);
  });

  it('se actualiza cuando el motor cambia', async () => {
    const engine = createFakeSyncEngine();
    await renderSheet(engine);
    expect(screen.getByText('Todo al día')).toBeOnTheScreen();
    await act(() => engine.setStatus({ state: 'pending', pending: 4 }));
    expect(screen.getByText('4 cambios por subir')).toBeOnTheScreen();
  });

  it('habla en inglés', async () => {
    await act(() => changeLanguage('en'));
    await renderSheet(createFakeSyncEngine({ state: 'pending', pending: 2 }));
    expect(screen.getByText('2 changes to upload')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeOnTheScreen();
  });
});
