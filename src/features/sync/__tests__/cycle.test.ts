import type {
  ApplyOutcome,
  Mutation,
  PullResponse,
  PushResult,
  RemoteGroupChanges,
  SyncNotice,
  SyncRemote,
  SyncStore,
} from '@/db/sync';

import { runSyncCycle } from '../cycle';

const mutation = (n: number): Mutation => ({
  id: `01990000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  entity: 'group',
  base: null,
  data: { id: `g${n}` },
});

const notice = (draftId: string): SyncNotice => ({
  draftId,
  groupId: 'g',
  entity: 'group',
  reason: 'conflict',
  label: 'Viaje',
  serverDeleted: false,
  wasNew: false,
  wasDeletion: false,
});

type CycleStore = Pick<
  SyncStore,
  'nextBatch' | 'applyPushResults' | 'cursors' | 'applyRemoteGroup'
>;

/** Un almacén falso con una cola fija de lotes. */
function fakeStore(batches: Mutation[][], notices: SyncNotice[][] = []) {
  const queue = [...batches];
  const applied: PushResult[][] = [];
  const store: CycleStore = {
    nextBatch: jest.fn(() => queue.shift() ?? []),
    applyPushResults: jest.fn((results: readonly PushResult[]) => {
      applied.push([...results]);
      return notices.shift() ?? [];
    }),
    cursors: jest.fn(() => ({})),
    applyRemoteGroup: jest.fn(() => ({ applied: 0, skipped: 0, held: false })),
  };
  return { store, applied };
}

const appliedResult = (m: Mutation): PushResult => ({
  id: m.id,
  status: 'applied',
  version: 1,
  current: [],
});

function fakeRemote(resultFor: (m: Mutation) => PushResult = appliedResult) {
  const push = jest.fn(async (mutations: readonly Mutation[]) => mutations.map(resultFor));
  const pull = jest.fn(async (): Promise<PullResponse> => ({ groups: [], hasMore: false }));
  const remote: SyncRemote = { push, pull };
  return { remote, push, pull };
}

describe('runSyncCycle (envío)', () => {
  it('sin cambios pendientes no envía nada', async () => {
    const { store } = fakeStore([]);
    const { remote, push } = fakeRemote();
    const result = await runSyncCycle({ store, remote });
    expect(push).not.toHaveBeenCalled();
    expect(result).toEqual({
      batches: 0,
      sent: 0,
      applied: 0,
      rejected: 0,
      failed: 0,
      pages: 1,
      pulled: 0,
      skipped: 0,
      held: 0,
      notices: [],
    });
  });

  it('envía lote tras lote hasta vaciar la cola y aplica cada respuesta', async () => {
    const first = [mutation(1), mutation(2)];
    const second = [mutation(3)];
    const { store, applied } = fakeStore([first, second]);
    const { remote, push } = fakeRemote();

    const result = await runSyncCycle({ store, remote });

    expect(push.mock.calls.map(([sent]) => sent)).toEqual([first, second]);
    expect(applied.map((results) => results.map((r) => r.id))).toEqual([
      first.map((m) => m.id),
      second.map((m) => m.id),
    ]);
    expect(result).toMatchObject({ batches: 2, sent: 3, applied: 3, rejected: 0, failed: 0 });
  });

  it('pide los lotes con los límites dados, o 50 envíos y 256 KiB por omisión', async () => {
    const { store } = fakeStore([]);
    const { remote } = fakeRemote();
    await runSyncCycle({ store, remote });
    expect(store.nextBatch).toHaveBeenLastCalledWith({ count: 50, bytes: 262_144 });
    await runSyncCycle({ store, remote, batch: { count: 2, bytes: 100 } });
    expect(store.nextBatch).toHaveBeenLastCalledWith({ count: 2, bytes: 100 });
  });

  it('cuenta aplicados, rechazados y fallidos, y junta los avisos', async () => {
    const batch = [mutation(1), mutation(2), mutation(3)];
    const { store } = fakeStore([batch], [[notice('d1')]]);
    const { remote } = fakeRemote((m) => {
      if (m.id === batch[1]?.id) {
        return { id: m.id, status: 'rejected', reason: 'conflict', current: [] };
      }
      if (m.id === batch[2]?.id) {
        return { id: m.id, status: 'failed', reason: 'invalid' };
      }
      return appliedResult(m);
    });
    const seen: SyncNotice[] = [];

    const result = await runSyncCycle({ store, remote, onNotice: (n) => seen.push(n) });

    expect(result).toMatchObject({ sent: 3, applied: 1, rejected: 1, failed: 1 });
    expect(result.notices.map((n) => n.draftId)).toEqual(['d1']);
    expect(seen.map((n) => n.draftId)).toEqual(['d1']);
  });

  it('si el envío falla, el error sale tal cual y el lote no se da por respondido', async () => {
    const { store, applied } = fakeStore([[mutation(1)], [mutation(2)]]);
    const boom = new Error('sin red');
    const push = jest.fn().mockRejectedValue(boom);
    const remote: SyncRemote = { push, pull: jest.fn() };

    await expect(runSyncCycle({ store, remote })).rejects.toBe(boom);
    expect(applied).toEqual([]);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('los avisos de los lotes anteriores llegan aunque falle uno posterior', async () => {
    const { store } = fakeStore([[mutation(1)], [mutation(2)]], [[notice('d1')]]);
    const push = jest
      .fn()
      .mockImplementationOnce(async (m: readonly Mutation[]) => m.map(appliedResult))
      .mockRejectedValueOnce(new Error('sin red'));
    const remote: SyncRemote = { push, pull: jest.fn() };
    const seen: SyncNotice[] = [];

    await expect(runSyncCycle({ store, remote, onNotice: (n) => seen.push(n) })).rejects.toThrow();
    expect(seen.map((n) => n.draftId)).toEqual(['d1']);
  });

  it('un almacén que nunca se vacía no deja el ciclo dando vueltas', async () => {
    const store: CycleStore = {
      ...fakeStore([]).store,
      nextBatch: jest.fn(() => [mutation(1)]),
      applyPushResults: jest.fn(() => []),
    };
    const { remote, push } = fakeRemote();
    const result = await runSyncCycle({ store, remote, maxBatches: 5 });
    expect(push).toHaveBeenCalledTimes(5);
    expect(result.batches).toBe(5);
  });
});

const group = (id: string, cursor: number): RemoteGroupChanges => ({ id, cursor, rows: [] });
const outcome = (over: Partial<ApplyOutcome> = {}): ApplyOutcome => ({
  applied: 1,
  skipped: 0,
  held: false,
  ...over,
});

describe('runSyncCycle (descarga)', () => {
  /** Un servidor falso con páginas fijas. */
  function pagedRemote(pages: PullResponse[]) {
    const queue = [...pages];
    const { remote, push, pull } = fakeRemote();
    pull.mockImplementation(async () => queue.shift() ?? { groups: [], hasMore: false });
    return { remote, push, pull };
  }

  it('descarga después de enviar, con los cursores del almacén y 2000 filas por página', async () => {
    const calls: string[] = [];
    const { store } = fakeStore([]);
    let batches = 0;
    store.nextBatch = jest.fn(() => {
      calls.push('nextBatch');
      batches += 1;
      return batches === 1 ? [mutation(1)] : [];
    });
    store.cursors = jest.fn(() => ({ g1: 4 }));
    const { remote, push, pull } = fakeRemote();
    push.mockImplementation(async (m) => {
      calls.push('push');
      return m.map(appliedResult);
    });
    pull.mockImplementation(async () => {
      calls.push('pull');
      return { groups: [], hasMore: false };
    });

    await runSyncCycle({ store, remote });

    expect(calls).toEqual(['nextBatch', 'push', 'nextBatch', 'pull']);
    expect(pull).toHaveBeenCalledWith({ g1: 4 }, 2000);
  });

  it('usa pullMaxRows y encadena las páginas hasta hasMore: false, aplicando cada grupo', async () => {
    const { store } = fakeStore([]);
    store.applyRemoteGroup = jest.fn(() => outcome({ applied: 2 }));
    const { remote, pull } = pagedRemote([
      { groups: [group('a', 3), group('b', 5)], hasMore: true },
      { groups: [group('c', 1)], hasMore: false },
    ]);

    const result = await runSyncCycle({ store, remote, pullMaxRows: 100 });

    expect(pull).toHaveBeenCalledTimes(2);
    expect(pull).toHaveBeenNthCalledWith(1, {}, 100);
    expect(store.applyRemoteGroup).toHaveBeenCalledTimes(3);
    expect((store.applyRemoteGroup as jest.Mock).mock.calls.map(([g]) => g.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(result).toMatchObject({ pages: 2, pulled: 6, skipped: 0, held: 0 });
  });

  it('cuenta lo saltado y lo retenido', async () => {
    const { store } = fakeStore([]);
    store.applyRemoteGroup = jest
      .fn()
      .mockReturnValueOnce(outcome({ applied: 1, skipped: 2 }))
      .mockReturnValueOnce(outcome({ applied: 0, held: true }));
    const { remote } = pagedRemote([{ groups: [group('a', 3), group('b', 5)], hasMore: false }]);

    const result = await runSyncCycle({ store, remote });

    expect(result).toMatchObject({ pulled: 1, skipped: 2, held: 1 });
  });

  it('un grupo retenido no se vuelve a pedir en el mismo ciclo, para no atascar a los demás', async () => {
    const { store } = fakeStore([]);
    store.applyRemoteGroup = jest.fn((g: RemoteGroupChanges) =>
      outcome({ applied: 0, held: g.id === 'a' }),
    );
    const { remote, pull } = pagedRemote([
      { groups: [group('a', 3)], hasMore: true },
      { groups: [group('b', 2)], hasMore: false },
    ]);

    await runSyncCycle({ store, remote });

    // El segundo pedido ya lleva el cursor de a, aunque el almacén no lo avanzó.
    expect(pull).toHaveBeenNthCalledWith(2, { a: 3 }, 2000);
    // El almacén sigue con el cursor de antes: el próximo ciclo lo reintenta.
    expect(store.cursors()).toEqual({});
  });

  it('un servidor que siempre dice hasMore no deja el ciclo dando vueltas', async () => {
    const { store } = fakeStore([]);
    const { remote, pull } = fakeRemote();
    pull.mockImplementation(async () => ({ groups: [group('a', 1)], hasMore: true }));

    const result = await runSyncCycle({ store, remote, maxPages: 4 });

    expect(pull).toHaveBeenCalledTimes(4);
    expect(result.pages).toBe(4);
  });

  it('si la descarga falla, el error sale tal cual y lo enviado ya quedó aplicado', async () => {
    const { store, applied } = fakeStore([[mutation(1)]]);
    const { remote, pull } = fakeRemote();
    const boom = new Error('sin red');
    pull.mockRejectedValue(boom);

    await expect(runSyncCycle({ store, remote })).rejects.toBe(boom);
    expect(applied).toHaveLength(1);
  });
});
