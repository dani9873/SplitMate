/** @jest-environment node */
import { createSyncRemote, readUnit, type Mutation, type SyncRemote } from '@/db/sync';
import { createSupabaseTestServer, type SupabaseTestServer } from '@/test/supabase-pglite';

import { runSyncCycle } from '../cycle';
import { createDevice, serverSnapshot, type Device } from '../test-utils';

let server: SupabaseTestServer;

beforeAll(async () => {
  server = await createSupabaseTestServer();
}, 90_000);

afterAll(async () => {
  await server.close();
});

let sequence = 100;
/** Id para envíos que manda "otro dispositivo" a mano. */
const uuid = () => `01990000-0000-7000-8000-${String(sequence++).padStart(12, '0')}`;

const count = async (query: string, params: unknown[] = []) =>
  Number((await server.query<{ n: string | number | bigint }>(query, params))[0]?.n);

const newPhone = async () => createDevice(server, await server.createUser('Ana'));

function addDinner(
  phone: Device,
  groupId: string,
  ids: readonly string[],
  overrides: { title?: string; amount?: number } = {},
) {
  const amount = overrides.amount ?? 3000;
  return phone.repos.expenses.add({
    groupId,
    title: overrides.title ?? 'Cena',
    amount,
    currency: 'USD',
    payers: [{ memberId: ids[0] as string, amount }],
    split: { method: 'equal', participants: [ids[0] as string, ids[1] as string] },
    occurredOn: '2026-10-09',
  });
}

/** Ids de los envíos que salen por `remote`, lote por lote. */
function recording(remote: SyncRemote, sent: string[][]): SyncRemote {
  return {
    ...remote,
    push: (mutations) => {
      sent.push(mutations.map((m) => m.id));
      return remote.push(mutations);
    },
  };
}

describe('subida: el teléfono crea y el servidor queda igual', () => {
  it('grupo, miembros, gastos (editado, borrado, en otra moneda) y transferencia', async () => {
    const phone = await newPhone();
    const { group, memberIds } = phone.createGroup();
    const [ana, beto, carla] = memberIds as [string, string, string];

    const dinner = addDinner(phone, group.id, memberIds);
    // Una edición deja partes borradas lógicamente: no deben viajar.
    phone.repos.expenses.update(dinner.id, dinner.version, {
      groupId: group.id,
      title: 'Cena rica',
      amount: 4500,
      currency: 'USD',
      payers: [{ memberId: beto, amount: 4500 }],
      split: {
        method: 'percentage',
        percentages: [
          { memberId: ana, basisPoints: 5000 },
          { memberId: beto, basisPoints: 2500 },
          { memberId: carla, basisPoints: 2500 },
        ],
      },
      occurredOn: '2026-10-09',
      notes: 'Con propina',
    });
    phone.repos.expenses.add({
      groupId: group.id,
      title: 'Hotel',
      amount: 10000,
      currency: 'EUR',
      exchangeRate: '1.1',
      rateDate: '2026-10-08',
      payers: [{ memberId: ana, amount: 10000 }],
      split: {
        method: 'shares',
        shares: [
          { memberId: ana, shares: 1 },
          { memberId: carla, shares: 2 },
        ],
      },
      occurredOn: '2026-10-08',
    });
    const gone = addDinner(phone, group.id, memberIds, { title: 'Taxi', amount: 700 });
    phone.repos.expenses.remove(gone.id, gone.version);
    phone.repos.transfers.add({
      groupId: group.id,
      fromMemberId: beto,
      toMemberId: ana,
      amount: 500,
      currency: 'USD',
      occurredOn: '2026-10-10',
    });
    phone.repos.groups.rename(group.id, group.version, 'Playa');

    const result = await phone.sync();

    expect(result).toMatchObject({ rejected: 0, failed: 0, notices: [] });
    expect(result.applied).toBe(result.sent);
    expect(phone.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0 });

    const local = await phone.snapshot();
    expect(local.expenses).toHaveLength(3);
    expect(local.groups).toMatchObject([{ name: 'Playa' }]);
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(local);

    // Todo quedó al día: otro ciclo no manda nada.
    expect(await phone.sync()).toMatchObject({ batches: 0, sent: 0 });
  });

  it('subida inicial de datos viejos: un grupo sin "yo" y un miembro quitado que sigue en un gasto', async () => {
    const phone = await newPhone();
    const { group, memberIds } = phone.createGroup({
      members: ['Ana', 'Beto', 'Carla'],
      withMe: false,
    });
    const [ana, , carla] = memberIds as [string, string, string];
    // Carla pagó y debe quedar en cero para poder quitarla: la transferencia la salda.
    phone.repos.expenses.add({
      groupId: group.id,
      title: 'Gasolina',
      amount: 1000,
      currency: 'USD',
      payers: [{ memberId: carla, amount: 1000 }],
      split: { method: 'equal', participants: [carla, ana] },
      occurredOn: '2026-10-09',
    });
    phone.repos.transfers.add({
      groupId: group.id,
      fromMemberId: ana,
      toMemberId: carla,
      amount: 500,
      currency: 'USD',
      occurredOn: '2026-10-10',
    });
    phone.repos.members.remove(carla, 1);
    expect(phone.repos.members.listByGroup(group.id)).toHaveLength(2);

    const result = await phone.sync();

    expect(result).toMatchObject({ rejected: 0, failed: 0 });
    const local = await phone.snapshot();
    expect(local.members.filter((m) => m.deleted)).toHaveLength(1);
    expect(local.members.every((m) => m.user_id === null)).toBe(true);
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(local);
    expect(
      await count(`select count(*) as n from public.expense_splits where member_id = $1`, [carla]),
    ).toBe(1);
  });
});

describe('fallas de red y del servidor', () => {
  it('sin red antes de enviar: nada llega; al volver, todo una sola vez', async () => {
    const phone = await newPhone();
    const { group, memberIds } = phone.createGroup();
    addDinner(phone, group.id, memberIds);

    phone.rpc.faults.failNext('offline');
    await expect(phone.sync()).rejects.toMatchObject({ kind: 'offline' });

    expect(await count(`select count(*) as n from public.groups where id = $1`, [group.id])).toBe(
      0,
    );
    expect(phone.store.counts()).toMatchObject({ pending: 5, failed: 0 });

    const result = await phone.sync();
    expect(result).toMatchObject({ sent: 5, applied: 5 });
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(await phone.snapshot());
    // Cada unidad escribió una sola entrada en el historial.
    expect(
      await count(
        `select count(*) as n from (
           select entity_id from public.change_log where group_id = $1
           group by entity_id having count(*) > 1) repetidas`,
        [group.id],
      ),
    ).toBe(0);
    expect(
      await count(`select count(*) as n from public.change_log where group_id = $1`, [group.id]),
    ).toBe(5);

    expect(await phone.sync()).toMatchObject({ sent: 0 });
  });

  it('error del servidor en el segundo lote: el primero queda confirmado y el segundo se repite con los mismos ids', async () => {
    const phone = await newPhone();
    const { group, memberIds } = phone.createGroup();
    addDinner(phone, group.id, memberIds);
    const limits = { count: 2, bytes: 262_144 };

    const first: string[][] = [];
    let calls = 0;
    const flaky: SyncRemote = {
      ...phone.remote,
      push: (mutations) => {
        calls += 1;
        if (calls === 2) {
          phone.rpc.faults.failNext('server-error');
        }
        first.push(mutations.map((m) => m.id));
        return phone.remote.push(mutations);
      },
    };
    await expect(
      runSyncCycle({ store: phone.store, remote: flaky, batch: limits }),
    ).rejects.toMatchObject({ kind: 'server' });

    // El primer lote (grupo y un miembro) quedó confirmado; el segundo no llegó a la base.
    expect(first).toHaveLength(2);
    expect(await count(`select count(*) as n from public.groups where id = $1`, [group.id])).toBe(
      1,
    );
    expect(
      await count(`select count(*) as n from public.group_members where group_id = $1`, [group.id]),
    ).toBe(1);
    expect(phone.store.counts().pending).toBe(3);

    const second: string[][] = [];
    const result = await runSyncCycle({
      store: phone.store,
      remote: recording(phone.remote, second),
      batch: limits,
    });

    // Lo que falló sale otra vez, igual, y el resto detrás.
    expect(second[0]).toEqual(first[1]);
    expect(second.flat()).toHaveLength(3);
    expect(result).toMatchObject({ sent: 3, applied: 3, rejected: 0, failed: 0 });
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(await phone.snapshot());
    expect(
      await count(`select count(*) as n from public.change_log where group_id = $1`, [group.id]),
    ).toBe(5);
  });

  it('respuesta perdida después del commit: el reintento no duplica ni sube versiones', async () => {
    const phone = await newPhone();
    const { group, memberIds } = phone.createGroup();
    const dinner = addDinner(phone, group.id, memberIds);

    phone.rpc.faults.failNext('lost-response');
    await expect(phone.sync()).rejects.toMatchObject({ kind: 'offline' });

    // El servidor aplicó todo, pero el teléfono no lo sabe.
    const countsOf = () =>
      Promise.all([
        count(`select count(*) as n from public.groups where id = $1`, [group.id]),
        ...['group_members', 'expenses', 'expense_payers', 'expense_splits'].map((table) =>
          count(`select count(*) as n from public.${table} where group_id = $1`, [group.id]),
        ),
      ]);
    const afterLoss = await countsOf();
    const logAfterLoss = await count(
      `select count(*) as n from public.change_log where group_id = $1`,
      [group.id],
    );
    expect(afterLoss).toEqual([1, 3, 1, 1, 2]);
    expect(phone.store.counts().pending).toBe(5);

    const result = await phone.sync();

    expect(result).toMatchObject({ sent: 5, applied: 5, rejected: 0, failed: 0 });
    expect(await countsOf()).toEqual(afterLoss);
    expect(
      await count(`select count(*) as n from public.change_log where group_id = $1`, [group.id]),
    ).toBe(logAfterLoss);
    // Ninguna versión subió por reenviar.
    expect(
      await server.query<{ version: number }>(`select version from public.expenses where id = $1`, [
        dinner.id,
      ]),
    ).toEqual([{ version: 1 }]);
    expect(
      await server.query<{ version: number }>(`select version from public.groups where id = $1`, [
        group.id,
      ]),
    ).toEqual([{ version: 1 }]);
    expect(phone.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0 });
    expect(phone.sqlite.exec(`SELECT server_version FROM expenses`)[0]?.values).toEqual([[1]]);
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(await phone.snapshot());
  });
});

describe('conflicto de versión: lo del usuario se conserva', () => {
  /** El teléfono con un gasto ya sincronizado y un "otro dispositivo" de la misma cuenta. */
  async function syncedDinner() {
    const phone = await newPhone();
    const { group, memberIds } = phone.createGroup();
    const dinner = addDinner(phone, group.id, memberIds);
    await phone.sync();
    const data = readUnit(phone.db, { entity: 'expense', id: dinner.id })!.data;
    const other = (change: Record<string, unknown>, base = 1): Mutation => ({
      id: uuid(),
      entity: 'expense',
      base,
      data: { ...data, ...change },
    });
    const edit = (local: { version: number }, title: string, amount: number) =>
      phone.repos.expenses.update(dinner.id, local.version, {
        groupId: group.id,
        title,
        amount,
        currency: 'USD',
        payers: [{ memberId: memberIds[0] as string, amount }],
        split: { method: 'equal', participants: [memberIds[0] as string, memberIds[1] as string] },
        occurredOn: '2026-10-09',
      });
    return { phone, group, memberIds, dinner, other, edit };
  }

  it('el mismo gasto editado en los dos: el servidor conserva el primero, tu versión queda en un borrador', async () => {
    const { phone, dinner, other, edit } = await syncedDinner();

    const [theirs] = await phone.remote.push([other({ title: 'Cena (otro)' })]);
    expect(theirs).toMatchObject({ status: 'applied', version: 2 });

    edit(dinner, 'Cena rica', 4000);
    const result = await phone.sync();

    expect(result).toMatchObject({ applied: 0, rejected: 1, failed: 0 });
    expect(result.notices).toMatchObject([
      {
        entity: 'expense',
        reason: 'conflict',
        label: 'Cena rica',
        serverDeleted: false,
        wasNew: false,
        wasDeletion: false,
      },
    ]);
    // El servidor no se pisó.
    expect(
      await server.query(
        `select title, amount::text as amount, version from public.expenses where id = $1`,
        [dinner.id],
      ),
    ).toEqual([{ title: 'Cena (otro)', amount: '3000', version: 2 }]);
    // El teléfono volvió a esa versión y sus dos lados coinciden.
    const local = phone.repos.expenses.get(dinner.id)!;
    expect(local).toMatchObject({ title: 'Cena (otro)', amount: 3000 });
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(await phone.snapshot());
    // Lo que el usuario escribió sigue completo.
    const [draft] = phone.store.listConflicts();
    expect(draft?.data).toMatchObject({ title: 'Cena rica', amount: 4000 });
    expect(phone.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 1 });

    // Al guardar el borrador sobre la versión actual, el servidor y el teléfono convergen.
    edit(local, 'Cena rica', 4000);
    phone.store.discardConflict(draft!.id);
    expect(await phone.sync()).toMatchObject({ applied: 1, rejected: 0 });
    expect(
      await server.query(`select title, version from public.expenses where id = $1`, [dinner.id]),
    ).toEqual([{ title: 'Cena rica', version: 3 }]);
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(await phone.snapshot());
    expect(phone.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0 });
  });

  it('editar algo que el otro borró: vuelve borrado y queda el borrador', async () => {
    const { phone, dinner, other, edit } = await syncedDinner();
    await phone.remote.push([other({ deleted: true, payers: [], splits: [] })]);

    edit(dinner, 'Cena rica', 4000);
    const result = await phone.sync();

    expect(result.notices).toMatchObject([{ serverDeleted: true, wasDeletion: false }]);
    expect(phone.repos.expenses.get(dinner.id)).toBeUndefined();
    const [draft] = phone.store.listConflicts();
    expect(draft).toMatchObject({ serverDeleted: true, entityId: dinner.id });
    expect(draft?.data).toMatchObject({ title: 'Cena rica', amount: 4000, deleted: false });
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(await phone.snapshot());
  });

  it('borrar algo que el otro editó: vuelve con la versión nueva y el borrador es un borrado', async () => {
    const { phone, dinner, other } = await syncedDinner();
    await phone.remote.push([other({ title: 'Cena (otro)' })]);

    phone.repos.expenses.remove(dinner.id, dinner.version);
    const result = await phone.sync();

    expect(result.notices).toMatchObject([{ wasDeletion: true, serverDeleted: false }]);
    expect(phone.repos.expenses.get(dinner.id)).toMatchObject({ title: 'Cena (otro)' });
    expect(phone.store.listConflicts()).toMatchObject([{ wasDeletion: true }]);
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(await phone.snapshot());

    // "Borrar ahora" sobre la versión actual: borra en los dos.
    const current = phone.repos.expenses.get(dinner.id)!;
    phone.repos.expenses.remove(dinner.id, current.version);
    phone.store.discardConflict(phone.store.listConflicts()[0]!.id);
    expect(await phone.sync()).toMatchObject({ applied: 1, rejected: 0 });
    expect(await serverSnapshot(server, phone.groupIds())).toEqual(await phone.snapshot());
    expect(phone.repos.expenses.get(dinner.id)).toBeUndefined();
  });

  it('un gasto nuevo sin conexión y la moneda del grupo cambiada en el otro: queda completo en el borrador', async () => {
    const phone = await newPhone();
    const { group, memberIds } = phone.createGroup();
    await phone.sync();
    const groupData = readUnit(phone.db, { entity: 'group', id: group.id })!.data;
    const [changed] = await phone.remote.push([
      { id: uuid(), entity: 'group', base: 1, data: { ...groupData, currency: 'EUR' } },
    ]);
    expect(changed).toMatchObject({ status: 'applied', version: 2 });

    const dinner = addDinner(phone, group.id, memberIds);
    const result = await phone.sync();

    expect(result).toMatchObject({ applied: 0, rejected: 1 });
    expect(result.notices).toMatchObject([{ reason: 'group_currency_changed', wasNew: true }]);
    expect(phone.repos.expenses.listByGroup(group.id)).toEqual([]);
    expect(
      await count(`select count(*) as n from public.expenses where group_id = $1`, [group.id]),
    ).toBe(0);
    const [draft] = phone.store.listConflicts();
    expect(draft).toMatchObject({ entityId: dinner.id, wasNew: true });
    expect(draft?.data).toMatchObject({ title: 'Cena', amount: 3000, group_currency: 'USD' });
    // No se vuelve a mandar.
    expect(await phone.sync()).toMatchObject({ sent: 0 });
  });

  it('el mismo cambio en los dos: sin rechazo', async () => {
    const phone = await newPhone();
    const { group } = phone.createGroup();
    await phone.sync();
    const data = readUnit(phone.db, { entity: 'group', id: group.id })!.data;
    await phone.remote.push([
      { id: uuid(), entity: 'group', base: 1, data: { ...data, name: 'Playa' } },
    ]);

    phone.repos.groups.rename(group.id, group.version, 'Playa');
    const result = await phone.sync();

    expect(result).toMatchObject({ applied: 1, rejected: 0, failed: 0, notices: [] });
    expect(phone.store.listConflicts()).toEqual([]);
    expect(
      await server.query(`select version from public.groups where id = $1`, [group.id]),
    ).toEqual([{ version: 2 }]);
  });
});

describe('descarga paginada del servidor (lectura)', () => {
  it('las páginas encadenan por hasMore sin partir un grupo y juntas traen todo', async () => {
    const phone = await newPhone();
    const sizes: number[] = [];
    for (let g = 0; g < 3; g += 1) {
      const { group, memberIds } = phone.createGroup({ name: `Grupo ${g}` });
      for (let e = 0; e < 15; e += 1) {
        addDinner(phone, group.id, memberIds, { title: `Gasto ${e}`, amount: 1000 + e });
      }
      sizes.push(1 + 3 + 15 * 4);
    }
    const result = await phone.sync();
    expect(result).toMatchObject({ failed: 0, rejected: 0 });

    const remote = createSyncRemote(server.rpcFor(phone.userId));
    const cursors: Record<string, number> = {};
    const received = new Map<string, number>();
    let pages = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await remote.pull(cursors, 100);
      pages += 1;
      for (const changes of page.groups) {
        // Un grupo llega entero en una sola página.
        expect(received.has(changes.id)).toBe(false);
        received.set(changes.id, changes.rows.length);
        cursors[changes.id] = changes.cursor;
      }
      hasMore = page.hasMore;
      expect(pages).toBeLessThan(10);
    }

    expect(pages).toBeGreaterThan(1);
    expect([...received.keys()].sort()).toEqual(phone.groupIds().sort());
    expect([...received.values()].sort()).toEqual([...sizes].sort());
    // Con los cursores finales ya no hay nada nuevo.
    expect(await remote.pull(cursors, 100)).toEqual({ groups: [], hasMore: false });
  });
});
