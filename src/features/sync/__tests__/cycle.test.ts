import type { Mutation, PushResult, SyncNotice, SyncStore, SyncRemote } from '@/db/sync';

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

/** Un almacén falso con una cola fija de lotes. */
function fakeStore(batches: Mutation[][], notices: SyncNotice[][] = []) {
  const queue = [...batches];
  const applied: PushResult[][] = [];
  const store: Pick<SyncStore, 'nextBatch' | 'applyPushResults'> = {
    nextBatch: jest.fn(() => queue.shift() ?? []),
    applyPushResults: jest.fn((results: readonly PushResult[]) => {
      applied.push([...results]);
      return notices.shift() ?? [];
    }),
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
  const remote: SyncRemote = { push, pull: jest.fn() };
  return { remote, push };
}

describe('runSyncCycle (solo envío)', () => {
  it('sin cambios pendientes no llama al servidor', async () => {
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
    const store: Pick<SyncStore, 'nextBatch' | 'applyPushResults'> = {
      nextBatch: jest.fn(() => [mutation(1)]),
      applyPushResults: jest.fn(() => []),
    };
    const { remote, push } = fakeRemote();
    const result = await runSyncCycle({ store, remote, maxBatches: 5 });
    expect(push).toHaveBeenCalledTimes(5);
    expect(result.batches).toBe(5);
  });
});
