/** @jest-environment node */
import { createSyncRemote, type SyncRemote } from '@/db/sync';
import { createSupabaseTestServer, type SupabaseTestServer } from '@/test/supabase-pglite';

import { runSyncCycle } from '../cycle';
import { createDevice, serverSnapshot, type Device } from '../test-utils';

/**
 * La Fase 4b de punta a punta contra el servidor de prueba (PGlite con las migraciones reales), con
 * tres cuentas y dos o más dispositivos: A es la dueña del grupo, B entra por un enlace e interviene
 * y C es ajena. Las invitaciones se crean y se aceptan con las RPC del servidor; el motor del
 * cliente hace las descargas.
 */

let server: SupabaseTestServer;

beforeAll(async () => {
  server = await createSupabaseTestServer();
}, 90_000);

afterAll(async () => {
  await server.close();
});

const one = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  (await server.query<T>(query, params))[0];

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

/** Tres cuentas y el grupo de A ya subido, con una invitación que B puede usar. */
async function world(options: { expenses?: number } = {}) {
  const a = await createDevice(server, await server.createUser('Ana'), { name: 'Ana' });
  const b = await createDevice(server, await server.createUser('Beto'), { name: 'Beto' });
  const c = await createDevice(server, await server.createUser('Caro'), { name: 'Caro' });
  const { group, memberIds } = a.createGroup({ name: 'Viaje', members: ['Ana', 'Beto', 'Caro'] });
  const expenses = Array.from({ length: options.expenses ?? 1 }, (_, i) =>
    addDinner(a, group.id, memberIds, { title: `Cena ${i}`, amount: 3000 + i }),
  );
  await a.sync();
  const invite = async (device: Device = a, hours = 168, uses = 10) =>
    (await device.rpc('create_invitation', {
      p_group_id: group.id,
      p_expires_hours: hours,
      p_max_uses: uses,
    })) as { id: string; token: string };
  const join = async (device: Device, token: string, memberId: string) =>
    (await device.rpc('accept_invitation', { p_token: token, p_member_id: memberId })) as {
      group_id?: string;
      error?: string;
    };
  return { a, b, c, group, memberIds, expenses, invite, join };
}

const rowsOf = (device: Device, query: string) => {
  const result = device.sqlite.exec(query)[0];
  return (result?.values ?? []).map((values) =>
    Object.fromEntries(result!.columns.map((name, i) => [name, values[i]])),
  );
};

describe('B se une por un enlace y descarga el grupo completo', () => {
  it('B recibe el grupo, sus miembros, el gasto y los accesos, y queda igual que el servidor', async () => {
    const { a, b, group, memberIds, invite, join } = await world();
    const { token } = await invite();

    expect(await join(b, token, memberIds[1] as string)).toEqual({ group_id: group.id });
    const result = await b.sync();

    expect(result).toMatchObject({ held: 0, failed: 0, rejected: 0 });
    expect(b.groupIds()).toEqual([group.id]);
    expect(await b.snapshot()).toEqual(await serverSnapshot(server, [group.id]));
    await a.sync();
    expect(await b.snapshot()).toEqual(await a.snapshot());
    // Los dos accesos (la dueña y B) y la cuenta de A como usuario remoto.
    expect(
      rowsOf(b, `SELECT role, user_id FROM group_access ORDER BY role`).map((r) => r.role),
    ).toEqual(['member', 'owner']);
    expect(rowsOf(b, `SELECT is_remote FROM users WHERE id = '${a.userId}'`)).toEqual([
      { is_remote: 1 },
    ]);
    // Beto quedó vinculado a la cuenta de B en el miembro que eligió.
    expect(rowsOf(b, `SELECT user_id FROM group_members WHERE id = '${memberIds[1]}'`)).toEqual([
      { user_id: b.userId },
    ]);
    expect(rowsOf(b, 'PRAGMA foreign_key_check')).toEqual([]);
    expect(b.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0, lost: 0 });
  });

  it('A y B editan y los dos dispositivos convergen con el servidor', async () => {
    const { a, b, group, memberIds, expenses, invite, join } = await world();
    const { token } = await invite();
    await join(b, token, memberIds[1] as string);
    await b.sync();

    editDinner(b, expenses[0]!.id, group.id, memberIds, 'Cena de B');
    addDinner(a, group.id, memberIds, { title: 'Taxi de A', amount: 1200 });
    addDinner(b, group.id, memberIds, { title: 'Café de B', amount: 800 });
    for (let round = 0; round < 3; round += 1) {
      await a.sync();
      await b.sync();
    }

    const server_ = await serverSnapshot(server, [group.id]);
    expect(await a.snapshot()).toEqual(server_);
    expect(await b.snapshot()).toEqual(server_);
    expect(server_.expenses.map((e) => e.title).sort()).toEqual([
      'Café de B',
      'Cena de B',
      'Taxi de A',
    ]);
    expect(a.store.counts()).toMatchObject({ pending: 0, conflicts: 0 });
    expect(b.store.counts()).toMatchObject({ pending: 0, conflicts: 0 });
  });

  it('C, que es ajena, no recibe nada', async () => {
    const { c, invite, a } = await world();
    await invite(a);
    const result = await c.sync();
    expect(result).toMatchObject({ pulled: 0, held: 0 });
    expect(c.groupIds()).toEqual([]);
    expect(rowsOf(c, 'SELECT count(*) AS n FROM group_access')).toEqual([{ n: 0 }]);
  });
});

describe('A quita el acceso a B', () => {
  it('con cambios de B sin subir: el grupo queda de solo lectura, no se pierde nada y se cuenta aparte', async () => {
    const { a, b, group, memberIds, expenses, invite, join } = await world();
    const { token } = await invite();
    await join(b, token, memberIds[1] as string);
    await b.sync();
    const before = await b.snapshot();

    // B edita sin conexión; A le quita el acceso.
    editDinner(b, expenses[0]!.id, group.id, memberIds, 'Cena editada sin red');
    await a.rpc('remove_access', { p_group_id: group.id, p_user_id: b.userId });

    const result = await b.sync();

    expect(result).toMatchObject({ lost: 1, held: 0 });
    expect(rowsOf(b, 'SELECT access_lost_at FROM groups')).toEqual([
      { access_lost_at: expect.any(Number) },
    ]);
    // Nada se perdió: el grupo sigue en el teléfono, con el cambio sin subir.
    expect(b.groupIds()).toEqual([group.id]);
    const after = await b.snapshot();
    expect(after.expenses.map((e) => e.title)).toEqual(['Cena editada sin red']);
    expect(after.members).toEqual(before.members);
    // Lo pendiente no se sube y se cuenta aparte.
    expect(b.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0, lost: 1 });
    expect(
      await one<{ title: string }>(`select title from public.expenses where id = $1`, [
        expenses[0]!.id,
      ]),
    ).toEqual({ title: 'Cena 0' });
    // Y los ciclos siguientes no lo vuelven a intentar ni inventan cursores.
    await b.sync();
    expect(b.store.pullCursors()).toEqual({});
    expect(b.store.counts()).toMatchObject({ lost: 1, pending: 0 });
  });

  it('B vuelve con otra invitación: se limpia el aviso y su cambio se envía', async () => {
    const { a, b, group, memberIds, expenses, invite, join } = await world();
    const first = await invite();
    await join(b, first.token, memberIds[1] as string);
    await b.sync();
    editDinner(b, expenses[0]!.id, group.id, memberIds, 'Cena editada sin red');
    await a.rpc('remove_access', { p_group_id: group.id, p_user_id: b.userId });
    await b.sync();
    expect(b.store.counts().lost).toBe(1);

    // Expulsar revoca los enlaces vigentes: A crea uno nuevo y B vuelve con él.
    expect((await join(b, first.token, memberIds[1] as string)).error).toBe('SMINV');
    const second = await invite();
    expect(await join(b, second.token, memberIds[1] as string)).toEqual({ group_id: group.id });
    await b.sync();
    await b.sync();

    expect(rowsOf(b, 'SELECT access_lost_at FROM groups')).toEqual([{ access_lost_at: null }]);
    expect(b.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0, lost: 0 });
    expect(
      await one<{ title: string }>(`select title from public.expenses where id = $1`, [
        expenses[0]!.id,
      ]),
    ).toEqual({ title: 'Cena editada sin red' });
    await a.sync();
    expect(await a.snapshot()).toEqual(await b.snapshot());
  });

  it('si A cambió lo mismo mientras B no tenía acceso, el cambio de B queda como borrador', async () => {
    const { a, b, group, memberIds, expenses, invite, join } = await world();
    const first = await invite();
    await join(b, first.token, memberIds[1] as string);
    await b.sync();
    editDinner(b, expenses[0]!.id, group.id, memberIds, 'Versión de B');
    await a.rpc('remove_access', { p_group_id: group.id, p_user_id: b.userId });
    await b.sync();
    editDinner(a, expenses[0]!.id, group.id, memberIds, 'Versión de A');
    await a.sync();

    const second = await invite();
    await join(b, second.token, memberIds[1] as string);
    await b.sync();
    await b.sync();

    expect(b.store.counts()).toMatchObject({ pending: 0, lost: 0, conflicts: 1 });
    expect(b.store.listConflicts()).toMatchObject([{ entity: 'expense', reason: 'conflict' }]);
    expect(rowsOf(b, 'SELECT title FROM expenses')).toEqual([{ title: 'Versión de A' }]);
  });

  it('B sale del grupo desde otro teléfono: este recibe lost y queda de solo lectura', async () => {
    const { a, b, group, memberIds, invite, join } = await world();
    const { token } = await invite();
    await join(b, token, memberIds[1] as string);
    await b.sync();
    const tablet = await createDevice(server, b.userId, { name: 'Beto' });
    await tablet.sync();
    expect(tablet.groupIds()).toEqual([group.id]);

    await tablet.rpc('leave_group', { p_group_id: group.id });
    await tablet.sync();
    const result = await b.sync();

    expect(result.lost).toBe(1);
    expect(rowsOf(b, 'SELECT access_lost_at FROM groups')).toEqual([
      { access_lost_at: expect.any(Number) },
    ]);
    // A sigue viendo el grupo, con el miembro de B sin cuenta.
    await a.sync();
    expect(rowsOf(a, `SELECT user_id FROM group_members WHERE id = '${memberIds[1]}'`)).toEqual([
      { user_id: null },
    ]);
  });
});

describe('descarga por páginas de un grupo grande', () => {
  /** Un remoto que, tras la primera respuesta, deja que ocurra algo en el servidor. */
  function remoteWithHook(base: SyncRemote, afterFirstPage: () => Promise<void>): SyncRemote {
    let pages = 0;
    return {
      push: (mutations) => base.push(mutations),
      async pull(cursors, maxRows) {
        const response = await base.pull(cursors, maxRows);
        pages += 1;
        if (pages === 1) {
          await afterFirstPage();
        }
        return response;
      },
    };
  }

  it('un grupo de más filas que el tope baja en varias páginas y queda igual al servidor', async () => {
    const { a, b, group, memberIds, invite, join } = await world({ expenses: 30 });
    const { token } = await invite();
    await join(b, token, memberIds[1] as string);

    const result = await b.sync({ pullMaxRows: 100 });

    // 1 grupo + 2 accesos + 3 miembros + 30 gastos con pagador y 2 partes = 126 filas.
    expect(result.pages).toBeGreaterThan(2);
    expect(result).toMatchObject({ held: 0 });
    expect(await b.snapshot()).toEqual(await serverSnapshot(server, [group.id]));
    await a.sync();
    expect(await b.snapshot()).toEqual(await a.snapshot());
    expect(rowsOf(b, 'SELECT count(*) AS n FROM sync_pull_pages')).toEqual([{ n: 0 }]);
    expect(b.store.pullCursors()[group.id]).toEqual(expect.any(Number));
    expect(rowsOf(b, 'PRAGMA foreign_key_check')).toEqual([]);
    // Con los cursores finales ya no hay nada nuevo.
    const again = await b.sync({ pullMaxRows: 100 });
    expect(again).toMatchObject({ pulled: 0, held: 0 });
  });

  it('una fila que cambia mientras se baja llega en la ronda siguiente, sin perderse', async () => {
    const { a, b, group, memberIds, expenses, invite, join } = await world({ expenses: 30 });
    const { token } = await invite();
    await join(b, token, memberIds[1] as string);

    const hooked = remoteWithHook(createSyncRemote(b.rpc), async () => {
      // A edita un gasto y un miembro justo después de la primera página.
      editDinner(a, expenses[0]!.id, group.id, memberIds, 'Cena cambiada a mitad de la descarga');
      await a.sync();
    });
    await runSyncCycle({ store: b.store, remote: hooked, pullMaxRows: 100 });
    // Si algo quedó para el siguiente ciclo, ahí llega.
    await b.sync({ pullMaxRows: 100 });
    await b.sync({ pullMaxRows: 100 });

    expect(await b.snapshot()).toEqual(await serverSnapshot(server, [group.id]));
    expect(rowsOf(b, `SELECT title FROM expenses WHERE id = '${expenses[0]!.id}'`)).toEqual([
      { title: 'Cena cambiada a mitad de la descarga' },
    ]);
    expect(rowsOf(b, 'SELECT count(*) AS n FROM sync_pull_pages')).toEqual([{ n: 0 }]);
    expect(b.store.counts()).toMatchObject({ pending: 0, conflicts: 0 });
  });
});

describe('borrar la cuenta de la dueña con el grupo compartido', () => {
  it('el grupo sigue para B, que pasa a ser la dueña, y el miembro de A queda sin cuenta', async () => {
    const { a, b, group, memberIds, invite, join } = await world();
    const { token } = await invite();
    await join(b, token, memberIds[1] as string);
    await b.sync();

    // Lo que hace auth.admin.deleteUser: la cascada borra la cuenta y su perfil.
    await server.query(`delete from auth.users where id = $1`, [a.userId]);
    const result = await b.sync();

    expect(result).toMatchObject({ held: 0, lost: 0 });
    expect(b.groupIds()).toEqual([group.id]);
    expect(rowsOf(b, `SELECT role FROM group_access WHERE user_id = '${b.userId}'`)).toEqual([
      { role: 'owner' },
    ]);
    expect(rowsOf(b, `SELECT user_id FROM group_members WHERE id = '${memberIds[0]}'`)).toEqual([
      { user_id: null },
    ]);
    expect(await b.snapshot()).toEqual(await serverSnapshot(server, [group.id]));
  });
});
