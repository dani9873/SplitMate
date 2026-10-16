import { act, render, screen, userEvent } from '@testing-library/react-native';

import { changeLanguage } from '@/i18n';

import { createFakeSyncEngine, type FakeSyncEngine } from '../fake-engine';
import { SyncEngineProvider } from '../SyncProvider';
import { SyncStatusButton } from '../SyncStatusButton';

async function renderButton(engine: FakeSyncEngine) {
  await render(
    <SyncEngineProvider engine={engine}>
      <SyncStatusButton />
    </SyncEngineProvider>,
  );
}

beforeEach(async () => {
  await act(() => changeLanguage('es'));
});

afterAll(async () => {
  await act(() => changeLanguage('en'));
});

describe('SyncStatusButton', () => {
  it.each([
    ['synced', {}, 'Sincronización: todo al día'],
    ['pending', { state: 'pending', pending: 3 }, 'Sincronización: cambios por subir'],
    ['offline', { state: 'offline' }, 'Sincronización: sin conexión'],
    ['error', { state: 'error', failed: 1 }, 'Sincronización: necesita tu atención'],
    ['syncing', { state: 'pending', syncing: true }, 'Sincronizando'],
  ] as const)('estado %s: nombre accesible y rol de botón', async (_name, patch, label) => {
    const engine = createFakeSyncEngine(patch);
    await renderButton(engine);
    expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
  });

  it('abre la hoja de estado al tocarlo', async () => {
    const user = userEvent.setup();
    await renderButton(createFakeSyncEngine());
    expect(screen.queryByText('Sincronizar ahora')).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Sincronización: todo al día' }));
    expect(screen.getByText('Sincronizar ahora')).toBeOnTheScreen();
  });

  it('sigue al motor: cambia de nombre cuando cambia el estado', async () => {
    const engine = createFakeSyncEngine();
    await renderButton(engine);
    expect(screen.getByRole('button', { name: 'Sincronización: todo al día' })).toBeOnTheScreen();

    await act(() => engine.setStatus({ state: 'offline' }));
    expect(screen.getByRole('button', { name: 'Sincronización: sin conexión' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sincronización: todo al día' })).toBeNull();
  });

  it('habla en inglés cuando la app está en inglés', async () => {
    await act(() => changeLanguage('en'));
    await renderButton(createFakeSyncEngine({ state: 'offline' }));
    expect(screen.getByRole('button', { name: 'Sync: offline' })).toBeOnTheScreen();
  });
});
