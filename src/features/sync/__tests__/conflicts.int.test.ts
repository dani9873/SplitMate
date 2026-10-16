/** @jest-environment node */
import { DEFAULT_GROUP_COLOR } from '@/lib/group-appearance';
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

const count = async (query: string, params: unknown[] = []) =>
  Number((await server.query<{ n: string | number | bigint }>(query, params))[0]?.n);

function addDinner(
  device: Device,
  groupId: string,
  ids: readonly string[],
  overrides: { title?: string; amount?: number } = {},
) {
  const amount = overrides.amount ?? 3000;
  return device.repos.expenses.add({
    groupId,
    title: overrides.title ?? 'Cena',
    amount,
    currency: 'USD',
    payers: [{ memberId: ids[0] as string, amount }],
    split: { method: 'equal', participants: [ids[0] as string, ids[1] as string] },
    occurredOn: '2026-10-09',
  });
}

/** Edita el gasto sobre la versión que ese dispositivo tiene ahora. */
function editDinner(
  device: Device,
  expenseId: string,
  groupId: string,
  ids: readonly string[],
  title: string,
  amount: number,
) {
  const current = device.repos.expenses.get(expenseId)!;
  return device.repos.expenses.update(expenseId, current.version, {
    groupId,
    title,
    amount,
    currency: 'USD',
    payers: [{ memberId: ids[0] as string, amount }],
    split: { method: 'equal', participants: [ids[0] as string, ids[1] as string] },
    occurredOn: '2026-10-09',
  });
}

/** El teléfono y la tablet de la misma cuenta, con un grupo (y un gasto) que los dos ya tienen. */
async function pair({ withDinner = true }: { withDinner?: boolean } = {}) {
  const userId = await server.createUser('Ana');
  const phone = await createDevice(server, userId);
  const tablet = await createDevice(server, userId);
  const { group, memberIds } = phone.createGroup();
  const dinner = withDinner ? addDinner(phone, group.id, memberIds) : undefined;
  await phone.sync();
  await tablet.sync();
  return { phone, tablet, group, memberIds, dinner: dinner as NonNullable<typeof dinner> };
}

/** Los tres lados coinciden: teléfono, tablet y servidor. */
async function expectConverged(phone: Device, tablet: Device) {
  const onServer = await serverSnapshot(server, phone.groupIds());
  expect(await phone.snapshot()).toEqual(onServer);
  expect(await tablet.snapshot()).toEqual(onServer);
}

/** Un `remote` que anota lo que baja cada página de descarga. */
function recordingPulls(device: Device, pages: { table: string }[][]) {
  return {
    ...device.remote,
    pull: async (cursors: Record<string, number>, maxRows: number) => {
      const response = await device.remote.pull(cursors, maxRows);
      pages.push(response.groups.flatMap((g) => g.rows.map((r) => ({ table: r.table }))));
      return response;
    },
  };
}

describe('descarga: la tablet recibe lo del teléfono', () => {
  it('descarga lo que creó el teléfono y los dos quedan iguales; el eco de lo propio no cambia nada', async () => {
    const userId = await server.createUser('Ana');
    const phone = await createDevice(server, userId);
    const tablet = await createDevice(server, userId);
    const { group, memberIds } = phone.createGroup();
    const dinner = addDinner(phone, group.id, memberIds);
    phone.repos.transfers.add({
      groupId: group.id,
      fromMemberId: memberIds[1] as string,
      toMemberId: memberIds[0] as string,
      amount: 500,
      currency: 'USD',
      occurredOn: '2026-10-10',
    });

    const first = await phone.sync();
    // El servidor le devuelve al teléfono lo que acaba de subir: no es un cambio.
    expect(first).toMatchObject({ rejected: 0, failed: 0, pulled: 0, held: 0 });
    expect(phone.repos.expenses.get(dinner.id)?.version).toBe(1);

    const result = await tablet.sync();

    expect(result).toMatchObject({ sent: 0, failed: 0, held: 0 });
    expect(result.pulled).toBeGreaterThan(0);
    expect(tablet.repos.expenses.get(dinner.id)).toMatchObject({ title: 'Cena', amount: 3000 });
    expect(tablet.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0 });
    await expectConverged(phone, tablet);
  });

  it('descarga incremental: un segundo ciclo sin cambios no baja filas; tras un cambio, solo ese', async () => {
    const { phone, tablet, group, memberIds, dinner } = await pair();

    const idle: { table: string }[][] = [];
    const quiet = await runSyncCycle({ store: tablet.store, remote: recordingPulls(tablet, idle) });
    expect(idle.flat()).toEqual([]);
    expect(quiet).toMatchObject({ pulled: 0, pages: 1 });

    editDinner(phone, dinner.id, group.id, memberIds, 'Cena rica', 4000);
    await phone.sync();

    const changed: { table: string }[][] = [];
    const result = await runSyncCycle({
      store: tablet.store,
      remote: recordingPulls(tablet, changed),
    });
    const tables = new Set(changed.flat().map((r) => r.table));
    expect(tables.has('expenses')).toBe(true);
    // Ni el grupo ni los miembros viajan otra vez.
    expect(tables.has('groups')).toBe(false);
    expect(tables.has('group_members')).toBe(false);
    expect(result.pulled).toBe(1);
    expect(tablet.repos.expenses.get(dinner.id)).toMatchObject({ title: 'Cena rica' });
    await expectConverged(phone, tablet);
  });

  it('en varias páginas con pullMaxRows chico: ningún grupo se parte y llega todo', async () => {
    const userId = await server.createUser('Ana');
    const phone = await createDevice(server, userId);
    const tablet = await createDevice(server, userId);
    for (let g = 0; g < 3; g += 1) {
      const { group, memberIds } = phone.createGroup({ name: `Grupo ${g}` });
      for (let e = 0; e < 8; e += 1) {
        addDinner(phone, group.id, memberIds, { title: `Gasto ${e}`, amount: 1000 + e });
      }
    }
    await phone.sync();

    const result = await tablet.sync({ pullMaxRows: 100 });

    expect(result.pages).toBeGreaterThan(1);
    expect(result).toMatchObject({ held: 0, failed: 0 });
    expect(tablet.groupIds().sort()).toEqual(phone.groupIds().sort());
    await expectConverged(phone, tablet);
    expect(await tablet.sync({ pullMaxRows: 100 })).toMatchObject({ pulled: 0, pages: 1 });
  });

  it('una segunda cuenta no recibe nada de la primera', async () => {
    const { phone } = await pair();
    const other = await createDevice(server, await server.createUser('Beto'), { name: 'Beto' });

    const result = await other.sync();

    expect(result).toMatchObject({ pulled: 0, held: 0 });
    expect(other.groupIds()).toEqual([]);
    expect(other.store.cursors()).toEqual({});
    expect(phone.groupIds()).toHaveLength(1);
  });
});

describe('conflicto de versión entre dos dispositivos: lo del usuario se conserva', () => {
  it('el mismo gasto editado en los dos: el primero queda, el segundo recibe el rechazo, su borrador y converge al guardarlo', async () => {
    const { phone, tablet, group, memberIds, dinner } = await pair();

    editDinner(phone, dinner.id, group.id, memberIds, 'Cena (teléfono)', 3500);
    await phone.sync();
    editDinner(tablet, dinner.id, group.id, memberIds, 'Cena (tablet)', 4000);

    const result = await tablet.sync();

    expect(result).toMatchObject({ applied: 0, rejected: 1, failed: 0 });
    expect(result.notices).toMatchObject([
      { entity: 'expense', reason: 'conflict', label: 'Cena (tablet)', wasNew: false },
    ]);
    // La tablet volvió a la versión del primero; el servidor no se pisó.
    expect(tablet.repos.expenses.get(dinner.id)).toMatchObject({
      title: 'Cena (teléfono)',
      amount: 3500,
    });
    expect(
      await server.query(`select title, version from public.expenses where id = $1`, [dinner.id]),
    ).toEqual([{ title: 'Cena (teléfono)', version: 2 }]);
    const [draft] = tablet.store.listConflicts();
    expect(draft?.data).toMatchObject({ title: 'Cena (tablet)', amount: 4000 });
    expect(await tablet.snapshot()).toEqual(await serverSnapshot(server, tablet.groupIds()));

    // Al guardar el borrador sobre la versión actual, los dos convergen.
    editDinner(tablet, dinner.id, group.id, memberIds, 'Cena (tablet)', 4000);
    tablet.store.discardConflict(draft!.id);
    expect(await tablet.sync()).toMatchObject({ applied: 1, rejected: 0 });
    await phone.sync();
    expect(phone.repos.expenses.get(dinner.id)).toMatchObject({ title: 'Cena (tablet)' });
    await expectConverged(phone, tablet);
    expect(tablet.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0 });
  });

  it('editar algo que el otro borró: vuelve borrado, queda el borrador y el aviso dice que está borrado', async () => {
    const { phone, tablet, group, memberIds, dinner } = await pair();

    phone.repos.expenses.remove(dinner.id, phone.repos.expenses.get(dinner.id)!.version);
    await phone.sync();
    editDinner(tablet, dinner.id, group.id, memberIds, 'Cena rica', 4000);

    const result = await tablet.sync();

    expect(result.notices).toMatchObject([{ serverDeleted: true, wasDeletion: false }]);
    expect(tablet.repos.expenses.get(dinner.id)).toBeUndefined();
    const [draft] = tablet.store.listConflicts();
    expect(draft).toMatchObject({ serverDeleted: true, entityId: dinner.id });
    expect(draft?.data).toMatchObject({ title: 'Cena rica', amount: 4000, deleted: false });
    await expectConverged(phone, tablet);
  });

  it('borrar algo que el otro editó: vuelve con la versión nueva; «Borrar ahora» lo borra en los dos', async () => {
    const { phone, tablet, group, memberIds, dinner } = await pair();

    editDinner(phone, dinner.id, group.id, memberIds, 'Cena (teléfono)', 3500);
    await phone.sync();
    tablet.repos.expenses.remove(dinner.id, tablet.repos.expenses.get(dinner.id)!.version);

    const result = await tablet.sync();

    expect(result.notices).toMatchObject([{ wasDeletion: true, serverDeleted: false }]);
    expect(tablet.repos.expenses.get(dinner.id)).toMatchObject({ title: 'Cena (teléfono)' });
    expect(tablet.store.listConflicts()).toMatchObject([{ wasDeletion: true }]);
    await expectConverged(phone, tablet);

    tablet.repos.expenses.remove(dinner.id, tablet.repos.expenses.get(dinner.id)!.version);
    tablet.store.discardConflict(tablet.store.listConflicts()[0]!.id);
    expect(await tablet.sync()).toMatchObject({ applied: 1, rejected: 0 });
    await phone.sync();
    expect(phone.repos.expenses.get(dinner.id)).toBeUndefined();
    await expectConverged(phone, tablet);
  });

  it('renombrar un grupo cambiado en el otro: vuelve el nombre del servidor y queda el borrador', async () => {
    const { phone, tablet, group } = await pair({ withDinner: false });

    phone.repos.groups.rename(group.id, phone.repos.groups.get(group.id)!.version, 'Playa');
    await phone.sync();
    tablet.repos.groups.rename(group.id, tablet.repos.groups.get(group.id)!.version, 'Montaña');

    const result = await tablet.sync();

    expect(result.notices).toMatchObject([
      { entity: 'group', reason: 'conflict', label: 'Montaña' },
    ]);
    expect(tablet.repos.groups.get(group.id)).toMatchObject({ name: 'Playa' });
    expect(tablet.store.listConflicts()[0]?.data).toMatchObject({ name: 'Montaña' });
    await expectConverged(phone, tablet);
  });

  it('gasto nuevo sin conexión y moneda del grupo cambiada en el otro: sale de los movimientos y queda completo en el borrador', async () => {
    const { phone, tablet, group, memberIds } = await pair({ withDinner: false });

    phone.repos.groups.update(group.id, phone.repos.groups.get(group.id)!.version, {
      name: 'Viaje',
      currency: 'EUR',
      emoji: null,
      color: DEFAULT_GROUP_COLOR,
    });
    await phone.sync();
    const dinner = addDinner(tablet, group.id, memberIds);

    const result = await tablet.sync();

    expect(result).toMatchObject({ applied: 0, rejected: 1 });
    expect(result.notices).toMatchObject([{ reason: 'group_currency_changed', wasNew: true }]);
    expect(tablet.repos.expenses.listByGroup(group.id)).toEqual([]);
    // La descarga del mismo ciclo trajo la moneda nueva.
    expect(tablet.repos.groups.get(group.id)).toMatchObject({ currency: 'EUR' });
    expect(
      await count(`select count(*) as n from public.expenses where group_id = $1`, [group.id]),
    ).toBe(0);
    const [draft] = tablet.store.listConflicts();
    expect(draft).toMatchObject({ entityId: dinner.id, wasNew: true });
    expect(draft?.data).toMatchObject({ title: 'Cena', amount: 3000, group_currency: 'USD' });
    expect(await tablet.sync()).toMatchObject({ sent: 0 });
    // El gasto rechazado queda en la tablet como borrado lógico (el servidor nunca lo tuvo): lo
    // demás coincide, y el teléfono no lo ve.
    const onServer = await serverSnapshot(server, phone.groupIds());
    const local = await tablet.snapshot();
    expect(local.groups).toEqual(onServer.groups);
    expect(local.members).toEqual(onServer.members);
    expect(local.expenses.every((e) => e.deleted === true)).toBe(true);
    expect(await phone.snapshot()).toEqual(onServer);
  });

  it('"soy yo" cambiado en los dos: el segundo recibe el rechazo y vuelve al del servidor', async () => {
    const { phone, tablet, group, memberIds } = await pair({ withDinner: false });
    const [, beto, carla] = memberIds as [string, string, string];

    phone.repos.members.setCurrentMember(group.id, beto);
    await phone.sync();
    tablet.repos.members.setCurrentMember(group.id, carla);

    const result = await tablet.sync();

    expect(result).toMatchObject({ rejected: 1, failed: 0, held: 0 });
    expect(result.notices).toMatchObject([{ entity: 'member', reason: 'conflict' }]);
    const mine = tablet.repos.members.listMine();
    expect(mine.map((m) => m.id)).toEqual([beto]);
    await expectConverged(phone, tablet);
  });

  it('el mismo cambio en los dos: sin rechazo ni borrador', async () => {
    const { phone, tablet, group } = await pair({ withDinner: false });

    phone.repos.groups.rename(group.id, phone.repos.groups.get(group.id)!.version, 'Playa');
    await phone.sync();
    tablet.repos.groups.rename(group.id, tablet.repos.groups.get(group.id)!.version, 'Playa');

    const result = await tablet.sync();

    expect(result).toMatchObject({ applied: 1, rejected: 0, failed: 0, notices: [] });
    expect(tablet.store.listConflicts()).toEqual([]);
    expect(
      await server.query(`select version from public.groups where id = $1`, [group.id]),
    ).toEqual([{ version: 2 }]);
    await expectConverged(phone, tablet);
  });

  it('un gasto nuevo en un grupo que el otro archivó: se guarda y el grupo sigue archivado', async () => {
    const { phone, tablet, group, memberIds } = await pair({ withDinner: false });

    phone.repos.groups.archive(group.id, phone.repos.groups.get(group.id)!.version);
    await phone.sync();
    const dinner = addDinner(tablet, group.id, memberIds);

    const result = await tablet.sync();

    expect(result).toMatchObject({ rejected: 0, failed: 0, notices: [] });
    expect(tablet.repos.groups.get(group.id)?.archivedAt).not.toBeNull();
    expect(
      await count(`select count(*) as n from public.expenses where id = $1`, [dinner.id]),
    ).toBe(1);
    await phone.sync();
    await expectConverged(phone, tablet);
  });
});
