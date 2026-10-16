import { createChangeBus, type ChangeBus } from '@/db/changes';
import {
  SyncTransportError,
  type Mutation,
  type PullResponse,
  type SyncCounts,
  type SyncNotice,
  type SyncRemote,
  type SyncStore,
} from '@/db/sync';

import { createSyncEngine, type NetworkMonitor, type Scheduler } from '../engine';

/** Reloj y temporizadores a mano: el tiempo solo avanza cuando la prueba lo dice. */
function manualScheduler(): Scheduler & { advance(ms: number): void; timers(): number } {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    timers: () => timers.size,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
  };
}

function fakeNetwork(initial = true) {
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
      listeners.forEach((l) => l(value));
    },
    listeners: () => listeners.size,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const EMPTY: PullResponse = { groups: [], hasMore: false };
const mutation: Mutation = { id: 'm1', entity: 'group', base: null, data: { id: 'g1' } };
const group = { id: 'g1', cursor: 5, rows: [] };

interface SetupOptions {
  online?: boolean;
  pull?: () => Promise<PullResponse>;
  ensureProfile?: () => Promise<'synced' | 'pending'>;
  store?: Partial<SyncStore>;
}

function setup(options: SetupOptions = {}) {
  const scheduler = manualScheduler();
  const network = fakeNetwork(options.online ?? true);
  const bus: ChangeBus = createChangeBus();
  const counts = { value: { pending: 0, failed: 0, conflicts: 0 } as SyncCounts };
  const pending = { batches: [] as Mutation[][] };
  const nextBatch = jest.fn(() => pending.batches.shift() ?? []);
  const retryFailed = jest.fn(() => 0);
  const store: SyncStore = {
    counts: () => counts.value,
    nextBatch,
    applyPushResults: jest.fn(() => []),
    cursors: () => ({}),
    applyRemoteGroup: jest.fn(() => ({ applied: 0, skipped: 0, held: false })),
    retryFailed,
    listConflicts: jest.fn(() => []),
    getConflict: jest.fn(),
    discardConflict: jest.fn(),
    ...options.store,
  };
  const pull = jest.fn(options.pull ?? (() => Promise.resolve(EMPTY)));
  const push = jest.fn((ms: readonly Mutation[]) =>
    Promise.resolve(
      ms.map((m) => ({ id: m.id, status: 'applied' as const, version: 1, current: [] })),
    ),
  );
  const remote: SyncRemote = { push, pull };
  const ensureProfile = jest.fn(
    options.ensureProfile ?? (() => Promise.resolve('synced' as const)),
  );
  const engine = createSyncEngine({
    store,
    remote,
    changes: bus,
    network: network.monitor,
    ensureProfile,
    scheduler,
    random: () => 0.5,
  });
  return {
    engine,
    scheduler,
    network,
    bus,
    counts,
    pull,
    push,
    nextBatch,
    retryFailed,
    ensureProfile,
    pending,
  };
}

const localWrite = (bus: ChangeBus) =>
  bus.emit({ source: 'local', tables: ['groups'], groupIds: ['g'] });

/** Una descarga que no termina hasta que la prueba la suelta. */
function gatedPull() {
  const gates: ((r?: PullResponse) => void)[] = [];
  const fn = jest.fn(
    () =>
      new Promise<PullResponse>((resolve) => {
        gates.push((r) => resolve(r ?? EMPTY));
      }),
  );
  return { fn, release: (i = 0) => gates[i]?.() };
}

const failWith = (kind: ConstructorParameters<typeof SyncTransportError>[0]) => () =>
  Promise.reject(new SyncTransportError(kind, 'x'));

describe('disparadores inmediatos', () => {
  it.each(['open', 'foreground', 'reconnect', 'manual'] as const)(
    '%s sincroniza de inmediato',
    async (trigger) => {
      const h = setup();
      h.engine.start();
      await flush();
      h.pull.mockClear();
      h.engine.request(trigger);
      await flush();
      expect(h.pull).toHaveBeenCalledTimes(1);
    },
  );

  it('start sincroniza al abrir, una vez conocida la red', async () => {
    const h = setup();
    h.engine.start();
    expect(h.pull).not.toHaveBeenCalled();
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('antes de start no hace nada', async () => {
    const h = setup();
    h.engine.request('manual');
    await flush();
    expect(h.pull).not.toHaveBeenCalled();
  });
});

describe('espera tras escribir', () => {
  it('cinco escrituras seguidas dan un solo ciclo, 2 s después de la última', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.pull.mockClear();
    for (let i = 0; i < 5; i++) {
      localWrite(h.bus);
      h.scheduler.advance(1_000);
    }
    expect(h.pull).not.toHaveBeenCalled();
    h.scheduler.advance(999);
    await flush();
    expect(h.pull).not.toHaveBeenCalled();
    h.scheduler.advance(1);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('como mucho 10 s después de la primera, aunque no deje de escribirse', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.pull.mockClear();
    for (let i = 0; i < 9; i++) {
      localWrite(h.bus);
      h.scheduler.advance(1_500);
      if (i === 5) {
        // 7,5 s desde la primera: todavía no.
        await flush();
        expect(h.pull).not.toHaveBeenCalled();
      }
    }
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('los cambios de la propia sincronización no disparan nada', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.pull.mockClear();
    h.bus.emit({ source: 'sync', tables: ['groups'], groupIds: ['g'] });
    h.scheduler.advance(60_000);
    await flush();
    expect(h.pull).not.toHaveBeenCalled();
  });

  it('un pedido inmediato cancela la espera pendiente', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.pull.mockClear();
    localWrite(h.bus);
    h.engine.request('foreground');
    await flush();
    h.scheduler.advance(5_000);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });
});

describe('un ciclo a la vez', () => {
  it('un pedido durante un ciclo produce exactamente un ciclo más', async () => {
    const gate = gatedPull();
    const h = setup({ pull: gate.fn });
    h.engine.start();
    await flush();
    expect(gate.fn).toHaveBeenCalledTimes(1);
    h.engine.request('foreground');
    h.engine.request('manual');
    h.engine.request('reconnect');
    await flush();
    expect(gate.fn).toHaveBeenCalledTimes(1);
    gate.release(0);
    await flush();
    expect(gate.fn).toHaveBeenCalledTimes(2);
    gate.release(1);
    await flush();
    expect(gate.fn).toHaveBeenCalledTimes(2);
    expect(h.engine.getStatus().syncing).toBe(false);
  });

  it('syncNow espera el ciclo en curso y el que pidió, y devuelve el estado final', async () => {
    const gate = gatedPull();
    const h = setup({ pull: gate.fn });
    h.engine.start();
    await flush();
    let result: unknown = null;
    const promise = h.engine.syncNow().then((s) => (result = s));
    gate.release(0);
    await flush();
    expect(result).toBeNull();
    gate.release(1);
    await promise;
    expect(result).toMatchObject({ state: 'synced', syncing: false });
    expect(gate.fn).toHaveBeenCalledTimes(2);
  });

  it('syncNow sin ciclo en curso corre uno', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.pull.mockClear();
    h.pending.batches.push([mutation]);
    const status = await h.engine.syncNow();
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(status.syncing).toBe(false);
  });
});

describe('sin sesión o sin red', () => {
  it('sin red no llama al servidor y el estado es sin conexión', async () => {
    const h = setup({ online: false });
    h.engine.start();
    await flush();
    h.engine.request('manual');
    localWrite(h.bus);
    h.scheduler.advance(20_000);
    await flush();
    expect(h.pull).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.engine.getStatus().state).toBe('offline');
  });

  it('al volver la red hace un ciclo', async () => {
    const h = setup({ online: false });
    h.engine.start();
    await flush();
    h.network.set(true);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
    expect(h.engine.getStatus().state).toBe('synced');
  });

  it('al perder la red el estado pasa a sin conexión', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.network.set(false);
    expect(h.engine.getStatus().state).toBe('offline');
  });

  it('syncNow sin red devuelve el estado sin conexión y no se cuelga', async () => {
    const h = setup({ online: false });
    h.engine.start();
    await flush();
    await expect(h.engine.syncNow()).resolves.toMatchObject({ state: 'offline' });
  });

  it('si leer la red falla, supone que hay red', async () => {
    const h = setup();
    const engine = createSyncEngine({
      store: {
        counts: () => h.counts.value,
        nextBatch: () => [],
        cursors: () => ({}),
        retryFailed: () => 0,
      } as never,
      remote: { push: h.push, pull: h.pull },
      changes: h.bus,
      network: {
        current: () => Promise.reject(new Error('sin permiso')),
        subscribe: () => () => undefined,
      },
      ensureProfile: h.ensureProfile,
      scheduler: h.scheduler,
      random: () => 0.5,
    });
    engine.start();
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
    engine.stop();
  });
});

describe('errores y reintentos', () => {
  it('error del servidor: reintenta a 5 s, 15 s, 45 s, 2 min y 5 min, y un éxito reinicia', async () => {
    let failing = true;
    const h = setup({
      pull: () => (failing ? failWith('server')() : Promise.resolve(EMPTY)),
    });
    h.engine.start();
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);

    const delays = [5_000, 15_000, 45_000, 120_000, 300_000, 300_000];
    let calls = 1;
    for (const delay of delays) {
      h.scheduler.advance(delay - 1);
      await flush();
      expect(h.pull).toHaveBeenCalledTimes(calls);
      h.scheduler.advance(1);
      await flush();
      calls += 1;
      expect(h.pull).toHaveBeenCalledTimes(calls);
    }

    failing = false;
    h.scheduler.advance(300_000);
    await flush();
    expect(h.engine.getStatus().state).toBe('synced');
    expect(h.scheduler.timers()).toBe(0);

    failing = true;
    h.engine.request('manual');
    await flush();
    const before = h.pull.mock.calls.length;
    h.scheduler.advance(4_999);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(before);
    h.scheduler.advance(1);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(before + 1);
  });

  it('un fallo de tiempo deja pendiente, no error', async () => {
    const h = setup({ pull: failWith('timeout') });
    h.counts.value = { pending: 1, failed: 0, conflicts: 0 };
    h.engine.start();
    await flush();
    expect(h.engine.getStatus().state).toBe('pending');
  });

  it('un error desconocido se trata como del servidor', async () => {
    const h = setup({ pull: () => Promise.reject(new Error('boom')) });
    h.engine.start();
    await flush();
    expect(h.scheduler.timers()).toBe(1);
    expect(h.engine.getStatus().syncing).toBe(false);
  });

  it('protocol: estado error y sin reintentos automáticos', async () => {
    const h = setup({ pull: failWith('protocol') });
    h.engine.start();
    await flush();
    expect(h.engine.getStatus().state).toBe('error');
    h.scheduler.advance(600_000);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('un error de red del transporte deja sin conexión y reintenta', async () => {
    const h = setup({ pull: failWith('offline') });
    h.engine.start();
    await flush();
    expect(h.engine.getStatus().state).toBe('offline');
    h.scheduler.advance(5_000);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(2);
  });

  it('una escritura durante la espera del reintento no se salta la espera', async () => {
    const h = setup({ pull: failWith('server') });
    h.engine.start();
    await flush();
    localWrite(h.bus);
    h.scheduler.advance(2_000);
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('un pedido del usuario durante la espera del reintento sí corre', async () => {
    const h = setup({ pull: failWith('server') });
    h.engine.start();
    await flush();
    h.engine.request('manual');
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(2);
  });
});

describe('estados que antes eran silenciosos', () => {
  it('envíos apartados: estado error, y retryFailed los devuelve y sincroniza', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.counts.value = { pending: 0, failed: 1, conflicts: 0 };
    h.engine.request('manual');
    await flush();
    expect(h.engine.getStatus()).toMatchObject({ state: 'error', failed: 1 });

    h.retryFailed.mockClear();
    h.pull.mockClear();
    h.engine.retryFailed();
    await flush();
    expect(h.retryFailed).toHaveBeenCalledTimes(1);
    expect(h.pull).toHaveBeenCalledTimes(1);
  });

  it('start reintenta los apartados antes del primer ciclo', async () => {
    const h = setup();
    const order: string[] = [];
    h.retryFailed.mockImplementation(() => {
      order.push('retry');
      return 0;
    });
    h.nextBatch.mockImplementation(() => {
      order.push('batch');
      return [];
    });
    h.engine.start();
    await flush();
    expect(order.slice(0, 2)).toEqual(['retry', 'batch']);
  });

  it('grupos retenidos por una fila inválida: error con la cuenta, y se limpia al corregirse', async () => {
    let held = true;
    const h = setup({
      pull: () => Promise.resolve({ groups: [group], hasMore: false }),
      store: { applyRemoteGroup: () => ({ applied: 0, skipped: 0, held }) },
    });
    h.engine.start();
    await flush();
    expect(h.engine.getStatus()).toMatchObject({ state: 'error', held: 1 });

    held = false;
    h.engine.retryFailed();
    await flush();
    expect(h.engine.getStatus()).toMatchObject({ state: 'synced', held: 0 });
  });

  it('cuenta los borradores por revisar', async () => {
    const h = setup();
    h.counts.value = { pending: 0, failed: 0, conflicts: 2 };
    h.engine.start();
    await flush();
    expect(h.engine.getStatus()).toMatchObject({ state: 'synced', conflicts: 2 });
  });
});

describe('perfil remoto', () => {
  it('se asegura una sola vez por sesión del motor cuando sale bien', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.engine.request('manual');
    await flush();
    h.engine.request('manual');
    await flush();
    expect(h.ensureProfile).toHaveBeenCalledTimes(1);
  });

  it('si no se pudo, descarga pero no envía, y lo vuelve a intentar en el siguiente ciclo', async () => {
    let result: 'synced' | 'pending' = 'pending';
    const h = setup({ ensureProfile: () => Promise.resolve(result) });
    h.counts.value = { pending: 1, failed: 0, conflicts: 0 };
    h.pending.batches.push([mutation]);
    h.engine.start();
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
    expect(h.push).not.toHaveBeenCalled();
    expect(h.engine.getStatus().state).toBe('pending');

    result = 'synced';
    h.engine.request('manual');
    await flush();
    expect(h.ensureProfile).toHaveBeenCalledTimes(2);
    expect(h.push).toHaveBeenCalledTimes(1);
  });

  it('si no se pudo, reintenta solo con la espera del reintento', async () => {
    const h = setup({ ensureProfile: () => Promise.resolve('pending') });
    h.engine.start();
    await flush();
    h.scheduler.advance(5_000);
    await flush();
    expect(h.ensureProfile).toHaveBeenCalledTimes(2);
  });

  it('si ensureProfile lanza, se trata como pendiente', async () => {
    const h = setup({ ensureProfile: () => Promise.reject(new Error('x')) });
    h.pending.batches.push([mutation]);
    h.engine.start();
    await flush();
    expect(h.pull).toHaveBeenCalledTimes(1);
    expect(h.push).not.toHaveBeenCalled();
  });
});

describe('estado y avisos', () => {
  it('syncing y lastSyncedAt', async () => {
    const gate = gatedPull();
    const h = setup({ pull: gate.fn });
    const seen: boolean[] = [];
    h.engine.subscribe(() => seen.push(h.engine.getStatus().syncing));
    h.engine.start();
    await flush();
    expect(h.engine.getStatus()).toMatchObject({ syncing: true, lastSyncedAt: null });
    gate.release(0);
    await flush();
    expect(h.engine.getStatus()).toMatchObject({ syncing: false, lastSyncedAt: 1_000_000 });
    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
  });

  it('los pendientes se actualizan con cada escritura local, sin esperar al ciclo', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    h.counts.value = { pending: 3, failed: 0, conflicts: 0 };
    localWrite(h.bus);
    expect(h.engine.getStatus()).toMatchObject({ state: 'pending', pending: 3 });
  });

  it('getStatus devuelve el mismo objeto mientras nada cambie y subscribe no avisa de más', async () => {
    const h = setup();
    h.engine.start();
    await flush();
    const first = h.engine.getStatus();
    const listener = jest.fn();
    h.engine.subscribe(listener);
    h.bus.emit({ source: 'sync', tables: ['groups'], groupIds: ['g'] });
    expect(h.engine.getStatus()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
  });

  it('los avisos del ciclo llegan a onNotice', async () => {
    const notice: SyncNotice = {
      draftId: 'd',
      groupId: 'g',
      entity: 'group',
      reason: 'conflict',
      label: 'Viaje',
      serverDeleted: false,
      wasNew: false,
      wasDeletion: false,
    };
    const h = setup({ store: { applyPushResults: () => [notice] } });
    h.pending.batches.push([mutation]);
    const received: SyncNotice[] = [];
    const off = h.engine.onNotice((n) => received.push(n));
    h.engine.start();
    await flush();
    expect(received).toEqual([notice]);
    off();
  });
});

describe('stop', () => {
  it('cancela temporizadores y suscripciones', async () => {
    const h = setup({ pull: failWith('server') });
    h.engine.start();
    await flush();
    localWrite(h.bus);
    expect(h.scheduler.timers()).toBeGreaterThan(0);
    h.engine.stop();
    expect(h.scheduler.timers()).toBe(0);
    expect(h.network.listeners()).toBe(0);
    h.pull.mockClear();
    localWrite(h.bus);
    h.network.set(true);
    h.engine.request('manual');
    h.scheduler.advance(600_000);
    await flush();
    expect(h.pull).not.toHaveBeenCalled();
  });

  it('un ciclo en curso al detenerse no deja temporizadores ni ciclos nuevos', async () => {
    const gate = gatedPull();
    const h = setup({ pull: gate.fn });
    h.engine.start();
    await flush();
    h.engine.request('manual');
    h.engine.stop();
    gate.release(0);
    await flush();
    expect(gate.fn).toHaveBeenCalledTimes(1);
    expect(h.scheduler.timers()).toBe(0);
  });

  it('un syncNow pendiente se resuelve al detenerse', async () => {
    const gate = gatedPull();
    const h = setup({ pull: gate.fn });
    h.engine.start();
    await flush();
    const promise = h.engine.syncNow();
    h.engine.stop();
    gate.release(0);
    await expect(promise).resolves.toBeDefined();
  });

  it('start dos veces no duplica suscripciones ni ciclos', async () => {
    const h = setup();
    h.engine.start();
    h.engine.start();
    await flush();
    expect(h.network.listeners()).toBe(1);
    expect(h.pull).toHaveBeenCalledTimes(1);
  });
});
