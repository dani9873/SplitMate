import { render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { createTestRepositories } from '@/db/test-utils';

import { createFakeSyncEngine, type FakeSyncEngine } from '../fake-engine';
import { SyncProvider, useSyncEngine, useSyncStatus } from '../SyncProvider';

function Probe() {
  const status = useSyncStatus();
  const engine = useSyncEngine();
  return <Text>{`${status.state}:${typeof engine.syncNow}`}</Text>;
}

async function renderProvider(
  engine: FakeSyncEngine,
  ensureProfile = async () => 'synced' as const,
) {
  const ctx = await createTestRepositories();
  const createEngine = jest.fn(() => engine);
  const view = await render(
    <DatabaseProvider value={{ db: ctx.db, repos: ctx.repos, bus: ctx.bus }}>
      <SyncProvider ensureProfile={ensureProfile} createEngine={createEngine}>
        <Probe />
      </SyncProvider>
    </DatabaseProvider>,
  );
  return { ...view, ctx, createEngine, ensureProfile };
}

describe('SyncProvider', () => {
  let appStateListener: ((state: string) => void) | null = null;
  const remove = jest.fn();

  beforeEach(() => {
    appStateListener = null;
    remove.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      listener: (state: string) => void,
    ) => {
      appStateListener = listener;
      return { remove };
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('crea el motor con la base y el bus de la cuenta y lo arranca', async () => {
    const engine = createFakeSyncEngine();
    const { ctx, createEngine, ensureProfile } = await renderProvider(engine);

    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(createEngine).toHaveBeenCalledWith({ db: ctx.db, bus: ctx.bus, ensureProfile });
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it('entrega el motor y su estado a los hijos', async () => {
    const { getByText } = await renderProvider(createFakeSyncEngine({ state: 'offline' }));
    expect(getByText('offline:function')).toBeOnTheScreen();
  });

  it('al desmontar detiene el motor y quita la escucha de AppState', async () => {
    const engine = createFakeSyncEngine();
    const { unmount } = await renderProvider(engine);
    await unmount();
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('al volver la app al primer plano pide sincronizar; en segundo plano no', async () => {
    const engine = createFakeSyncEngine();
    await renderProvider(engine);
    appStateListener?.('background');
    expect(engine.request).not.toHaveBeenCalled();
    appStateListener?.('active');
    expect(engine.request).toHaveBeenCalledWith('foreground');
  });
});
