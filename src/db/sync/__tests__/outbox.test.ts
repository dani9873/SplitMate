import { logger } from '@/lib/logger';

import type { DataChange } from '../../changes';
import { OTHER_CATEGORY_ID } from '../../repositories';
import { listConflicts } from '../conflicts';
import {
  applied,
  failed,
  iso,
  markEverythingSynced,
  rejected,
  rows,
  serverRow,
  setupSync,
  type SyncSetup,
} from '../test-fixtures';
import { listPendingUnits } from '../units';

const BIG = { count: 50, bytes: 262_144 };
const UNKNOWN_ID = '01990000-0000-7000-8000-000000000001';

const dinner = (s: SyncSetup, amount = 3000) =>
  s.repos.expenses.add({
    groupId: s.group.id,
    title: 'Cena',
    amount,
    currency: 'USD',
    payers: [{ memberId: s.ids[0] as string, amount }],
    split: { method: 'equal', participants: [s.ids[0] as string, s.ids[1] as string] },
    occurredOn: '2026-10-09',
  });

/** Las filas del gasto en el servidor, con los ids de pagadores y partes que se indiquen. */
function serverExpense(
  s: SyncSetup,
  id: string,
  fields: {
    version: number;
    title?: string;
    amount?: number;
    deleted?: boolean;
    payers: { id: string; memberId: string; deleted?: boolean }[];
    splits: { id: string; memberId: string; deleted?: boolean }[];
  },
) {
  const amount = fields.amount ?? 3000;
  const deletedAt = (deleted?: boolean) => (deleted ? iso(1_790_000_005_000) : null);
  const activeSplits = fields.splits.filter((p) => !(p.deleted ?? fields.deleted)).length || 1;
  return [
    serverRow('expenses', {
      id,
      group_id: s.group.id,
      kind: 'expense',
      title: fields.title ?? 'Cena',
      amount,
      currency: 'USD',
      group_currency: 'USD',
      group_amount: amount,
      exchange_rate: '1',
      rate_date: null,
      split_method: 'equal',
      category_id: OTHER_CATEGORY_ID,
      occurred_on: '2026-10-09',
      notes: null,
      version: fields.version,
      deleted_at: deletedAt(fields.deleted),
    }),
    ...fields.payers.map((p) =>
      serverRow('expense_payers', {
        id: p.id,
        group_id: s.group.id,
        expense_id: id,
        member_id: p.memberId,
        amount,
        group_amount: amount,
        version: 1,
        deleted_at: deletedAt(p.deleted ?? fields.deleted),
      }),
    ),
    ...fields.splits.map((p) =>
      serverRow('expense_splits', {
        id: p.id,
        group_id: s.group.id,
        expense_id: id,
        member_id: p.memberId,
        amount: amount / activeSplits,
        group_amount: amount / activeSplits,
        input_value: null,
        version: 1,
        deleted_at: deletedAt(p.deleted ?? fields.deleted),
      }),
    ),
  ];
}

describe('nextBatch', () => {
  it('arma el lote en orden con base nula y lo guarda antes de devolverlo', async () => {
    const s = await setupSync();
    const batch = s.store.nextBatch(BIG);

    expect(batch.map((m) => [m.entity, m.base])).toEqual([
      ['group', null],
      ['member', null],
      ['member', null],
      ['member', null],
    ]);
    expect(new Set(batch.map((m) => m.id)).size).toBe(4);

    const saved = rows<{ id: string; entity: string; data: string; state: string }>(
      s,
      `SELECT id, entity, data, state FROM sync_outbox ORDER BY created_at, id`,
    );
    expect(saved.map((r) => r.id).sort()).toEqual(batch.map((m) => m.id).sort());
    expect(saved.every((r) => r.state === 'in_flight')).toBe(true);
    const group = batch[0]!;
    expect(JSON.parse(saved.find((r) => r.id === group.id)!.data)).toEqual(group.data);
  });

  it('sin respuesta, repite los mismos envíos con el mismo id y contenido', async () => {
    const s = await setupSync();
    const first = s.store.nextBatch(BIG);
    // El usuario sigue editando mientras el envío está en vuelo.
    s.repos.groups.rename(s.group.id, s.group.version, 'Playa');
    const second = s.store.nextBatch(BIG);

    expect(second).toEqual(first);
    expect(second[0]?.data).toMatchObject({ name: 'Viaje' });
  });

  it('respeta el máximo de envíos y reparte el resto en el lote siguiente', async () => {
    const s = await setupSync();
    const first = s.store.nextBatch({ count: 2, bytes: BIG.bytes });
    expect(first.map((m) => m.entity)).toEqual(['group', 'member']);

    s.store.applyPushResults(first.map((m) => applied(m.id, 1)));
    const second = s.store.nextBatch({ count: 2, bytes: BIG.bytes });
    expect(second.map((m) => m.entity)).toEqual(['member', 'member']);
    expect(second.map((m) => m.id)).not.toEqual(first.map((m) => m.id));
  });

  it('respeta el máximo de bytes, pero siempre manda al menos un envío', async () => {
    const s = await setupSync();
    expect(s.store.nextBatch({ count: 50, bytes: 1 })).toHaveLength(1);

    const all = s.store.nextBatch(BIG);
    const size = (m: unknown) => new TextEncoder().encode(JSON.stringify(m)).length;
    const limit = size(all[0]) + size(all[1]) + 5;
    const two = s.store.nextBatch({ count: 50, bytes: limit });
    expect(two).toHaveLength(2);
  });

  it('sin cambios pendientes devuelve un lote vacío', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    expect(s.store.nextBatch(BIG)).toEqual([]);
  });

  it('lleva como base la versión del servidor, no la local', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    s.sqlite.run(`UPDATE groups SET server_version = 7`);
    s.repos.groups.rename(s.group.id, s.group.version, 'Playa');
    expect(s.store.nextBatch(BIG)).toMatchObject([{ entity: 'group', base: 7 }]);
  });
});

describe('applyPushResults: aplicado', () => {
  it('sin cambios en vuelo, la unidad queda al día', async () => {
    const s = await setupSync();
    const batch = s.store.nextBatch(BIG);
    const notices = s.store.applyPushResults(batch.map((m) => applied(m.id, 1)));

    expect(notices).toEqual([]);
    expect(listPendingUnits(s.db)).toEqual([]);
    expect(s.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0, lost: 0 });
    expect(rows(s, `SELECT server_version, synced_version, version FROM groups`)).toEqual([
      { server_version: 1, synced_version: 1, version: 1 },
    ]);
    expect(rows(s, `SELECT count(*) AS n FROM sync_outbox`)).toEqual([{ n: 0 }]);
  });

  it('el gasto guarda la versión del servidor de sus pagadores y partes', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    const expense = dinner(s);
    const [mutation] = s.store.nextBatch(BIG);
    const payer = expense.payers[0]!;
    const [split] = expense.splits;

    s.store.applyPushResults([
      applied(mutation!.id, 3, [
        serverRow('expenses', { id: expense.id, version: 3 }),
        serverRow('expense_payers', { id: payer.id, version: 2 }),
        serverRow('expense_splits', { id: split!.id, version: 4 }),
      ]),
    ]);

    expect(rows(s, `SELECT server_version, synced_version, version FROM expenses`)).toEqual([
      { server_version: 3, synced_version: 1, version: 1 },
    ]);
    expect(
      rows(s, `SELECT id, server_version FROM expense_payers WHERE id = '${payer.id}'`),
    ).toEqual([{ id: payer.id, server_version: 2 }]);
    expect(rows(s, `SELECT server_version FROM expense_splits WHERE id = '${split!.id}'`)).toEqual([
      { server_version: 4 },
    ]);
    expect(
      rows(s, `SELECT count(*) AS n FROM expense_splits WHERE synced_version <> version`),
    ).toEqual([{ n: 0 }]);
    expect(listPendingUnits(s.db)).toEqual([]);
  });

  it('con cambios en vuelo guarda la versión del servidor y la unidad sigue pendiente', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    s.repos.groups.rename(s.group.id, s.group.version, 'Playa');
    const [sent] = s.store.nextBatch(BIG);
    s.repos.groups.rename(s.group.id, 2, 'Costa');

    const notices = s.store.applyPushResults([applied(sent!.id, 2)]);

    expect(notices).toEqual([]);
    expect(rows(s, `SELECT name, server_version, version FROM groups`)).toEqual([
      { name: 'Costa', server_version: 2, version: 3 },
    ]);
    expect(s.store.counts().pending).toBe(1);
    const [next] = s.store.nextBatch(BIG);
    expect(next).toMatchObject({ entity: 'group', base: 2, data: { name: 'Costa' } });
    expect(next?.id).not.toBe(sent?.id);
  });

  it('ignora la respuesta de un envío que no conoce', async () => {
    const s = await setupSync();
    expect(s.store.applyPushResults([applied(UNKNOWN_ID, 1), failed(UNKNOWN_ID)])).toEqual([]);
    expect(s.store.counts().pending).toBe(4);
  });

  it('no avisa en el bus: no cambió nada que la pantalla muestre', async () => {
    const s = await setupSync();
    const batch = s.store.nextBatch(BIG);
    const seen: DataChange[] = [];
    s.bus.subscribe((change) => seen.push(change));
    s.store.applyPushResults(batch.map((m) => applied(m.id, 1)));
    expect(seen).toEqual([]);
  });
});

describe('applyPushResults: rechazado', () => {
  async function renamedGroup() {
    const s = await setupSync();
    markEverythingSynced(s);
    s.repos.groups.rename(s.group.id, s.group.version, 'Playa');
    const [mutation] = s.store.nextBatch(BIG);
    return { s, mutation: mutation! };
  }

  it('grupo: vuelve al estado del servidor, guarda tu versión y avisa', async () => {
    const { s, mutation } = await renamedGroup();
    const server = serverRow('groups', {
      id: s.group.id,
      name: 'Otro',
      currency: 'USD',
      emoji: null,
      color: s.group.color,
      archived_at: null,
      created_by: 'a0000000-0000-7000-8000-000000000000',
      version: 5,
    });

    const notices = s.store.applyPushResults([rejected(mutation.id, [server])]);

    const [draft] = listConflicts(s.db);
    expect(draft).toMatchObject({
      entity: 'group',
      entityId: s.group.id,
      groupId: s.group.id,
      reason: 'conflict',
      serverDeleted: false,
      wasNew: false,
      wasDeletion: false,
      data: mutation.data,
    });
    expect((draft?.data as { name: string }).name).toBe('Playa');
    expect(notices).toEqual([
      {
        draftId: draft!.id,
        groupId: s.group.id,
        entity: 'group',
        reason: 'conflict',
        label: 'Playa',
        serverDeleted: false,
        wasNew: false,
        wasDeletion: false,
      },
    ]);
    // El grupo vuelve al del servidor, al día, y con una versión local nueva (un formulario
    // abierto sobre la anterior da CONFLICT).
    expect(rows(s, `SELECT name, version, server_version, synced_version FROM groups`)).toEqual([
      { name: 'Otro', version: 3, server_version: 5, synced_version: 3 },
    ]);
    expect(listPendingUnits(s.db)).toEqual([]);
    expect(rows(s, `SELECT count(*) AS n FROM sync_outbox`)).toEqual([{ n: 0 }]);
    expect(s.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 1, lost: 0 });
  });

  it('avisa una sola vez en el bus, con origen sync y el grupo afectado', async () => {
    const { s, mutation } = await renamedGroup();
    const seen: DataChange[] = [];
    s.bus.subscribe((change) => seen.push(change));
    s.store.applyPushResults([
      rejected(mutation.id, [
        serverRow('groups', {
          id: s.group.id,
          name: 'Otro',
          currency: 'USD',
          emoji: null,
          color: s.group.color,
          archived_at: null,
          version: 5,
        }),
      ]),
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ source: 'sync' });
    expect([...(seen[0]?.groupIds ?? [])]).toEqual([s.group.id]);
    expect(seen[0]?.tables.has('groups')).toBe(true);
  });

  it('si seguiste editando mientras el envío estaba en vuelo, el borrador guarda tu última versión', async () => {
    const { s, mutation } = await renamedGroup();
    s.repos.groups.rename(s.group.id, 2, 'Costa');

    s.store.applyPushResults([
      rejected(mutation.id, [
        serverRow('groups', {
          id: s.group.id,
          name: 'Otro',
          currency: 'USD',
          emoji: null,
          color: s.group.color,
          archived_at: null,
          version: 5,
        }),
      ]),
    ]);

    const [draft] = listConflicts(s.db);
    expect((draft?.data as { name: string }).name).toBe('Costa');
    expect(rows(s, `SELECT name FROM groups`)).toEqual([{ name: 'Otro' }]);
  });

  it('moneda bloqueada: el grupo vuelve a la moneda del servidor y queda el borrador', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    s.repos.groups.update(s.group.id, s.group.version, {
      name: 'Viaje',
      currency: 'EUR',
      emoji: null,
      color: s.group.color,
    });
    const [mutation] = s.store.nextBatch(BIG);
    expect(mutation?.data).toMatchObject({ currency: 'EUR' });

    s.store.applyPushResults([
      rejected(
        mutation!.id,
        [
          serverRow('groups', {
            id: s.group.id,
            name: 'Viaje',
            currency: 'USD',
            emoji: null,
            color: s.group.color,
            archived_at: null,
            version: 4,
          }),
        ],
        'currency_locked',
      ),
    ]);

    expect(rows(s, `SELECT currency FROM groups`)).toEqual([{ currency: 'USD' }]);
    const [draft] = listConflicts(s.db);
    expect(draft).toMatchObject({ reason: 'currency_locked' });
    expect((draft?.data as { currency: string }).currency).toBe('EUR');
  });

  it('gasto editado en los dos: vuelve a la versión del servidor con sus pagadores y partes', async () => {
    const s = await setupSync();
    const expense = dinner(s);
    markEverythingSynced(s);
    const edited = s.repos.expenses.update(expense.id, expense.version, {
      groupId: s.group.id,
      title: 'Cena rica',
      amount: 4000,
      currency: 'USD',
      payers: [{ memberId: s.ids[0] as string, amount: 4000 }],
      split: { method: 'equal', participants: [s.ids[0] as string, s.ids[2] as string] },
      occurredOn: '2026-10-09',
    });
    const [mutation] = s.store.nextBatch(BIG);
    expect(mutation).toMatchObject({ entity: 'expense', base: 1 });

    // El otro dispositivo también cambió el gasto: pagó el mismo miembro (la parte nueva del
    // servidor choca con la local en el índice único si no se libera antes).
    const serverPayer = '01990000-0000-7000-8000-0000000000a1';
    const serverSplitA = '01990000-0000-7000-8000-0000000000b1';
    const serverSplitB = '01990000-0000-7000-8000-0000000000b2';
    const current = serverExpense(s, expense.id, {
      version: 3,
      title: 'Cena (otro)',
      amount: 5000,
      payers: [
        { id: expense.payers[0]!.id, memberId: s.ids[0] as string, deleted: true },
        { id: serverPayer, memberId: s.ids[0] as string },
      ],
      splits: [
        ...expense.splits.map((p) => ({ id: p.id, memberId: p.memberId, deleted: true })),
        { id: serverSplitA, memberId: s.ids[0] as string },
        { id: serverSplitB, memberId: s.ids[1] as string },
      ],
    });
    const notices = s.store.applyPushResults([rejected(mutation!.id, current)]);

    const local = s.repos.expenses.get(expense.id)!;
    expect(local).toMatchObject({ title: 'Cena (otro)', amount: 5000, groupAmount: 5000 });
    expect(local.payers.map((p) => p.id)).toEqual([serverPayer]);
    expect(local.splits.map((p) => p.id).sort()).toEqual([serverSplitA, serverSplitB]);
    expect(local.splits.map((p) => p.amount)).toEqual([2500, 2500]);
    // Lo que reemplazó la parte local sigue ahí, borrado lógicamente.
    expect(
      rows(s, `SELECT count(*) AS n FROM expense_payers WHERE deleted_at IS NOT NULL`),
    ).toEqual([{ n: 2 }]);
    expect(listPendingUnits(s.db)).toEqual([]);
    expect(rows(s, `SELECT server_version, synced_version, version FROM expenses`)).toEqual([
      { server_version: 3, synced_version: 3, version: edited.version + 1 },
    ]);

    // Tu versión completa queda en el borrador.
    const [draft] = listConflicts(s.db);
    const data = draft!.data as { title: string; payers: { id: string }[]; splits: unknown[] };
    expect(data.title).toBe('Cena rica');
    expect(data.payers.map((p) => p.id)).toEqual([edited.payers[0]!.id]);
    expect(data.splits).toHaveLength(2);
    expect(notices).toMatchObject([{ entity: 'expense', label: 'Cena rica', reason: 'conflict' }]);
  });

  it('gasto borrado en el servidor: vuelve borrado y el borrador lo dice', async () => {
    const s = await setupSync();
    const expense = dinner(s);
    markEverythingSynced(s);
    s.repos.expenses.update(expense.id, expense.version, {
      groupId: s.group.id,
      title: 'Cena rica',
      amount: 3000,
      currency: 'USD',
      payers: [{ memberId: s.ids[0] as string, amount: 3000 }],
      split: { method: 'equal', participants: [s.ids[0] as string] },
      occurredOn: '2026-10-09',
    });
    const [mutation] = s.store.nextBatch(BIG);

    const notices = s.store.applyPushResults([
      rejected(
        mutation!.id,
        serverExpense(s, expense.id, {
          version: 2,
          deleted: true,
          payers: expense.payers.map((p) => ({ id: p.id, memberId: p.memberId })),
          splits: expense.splits.map((p) => ({ id: p.id, memberId: p.memberId })),
        }),
      ),
    ]);

    expect(s.repos.expenses.get(expense.id)).toBeUndefined();
    expect(rows(s, `SELECT deleted_at IS NOT NULL AS gone FROM expenses`)).toEqual([{ gone: 1 }]);
    expect(rows(s, `SELECT count(*) AS n FROM expense_payers WHERE deleted_at IS NULL`)).toEqual([
      { n: 0 },
    ]);
    expect(listConflicts(s.db)).toMatchObject([{ serverDeleted: true, wasDeletion: false }]);
    expect(notices).toMatchObject([{ serverDeleted: true }]);
    expect(listPendingUnits(s.db)).toEqual([]);
  });

  it('borrado local de algo editado en el servidor: vuelve activo y el borrador es un borrado', async () => {
    const s = await setupSync();
    const expense = dinner(s);
    markEverythingSynced(s);
    s.repos.expenses.remove(expense.id, expense.version);
    const [mutation] = s.store.nextBatch(BIG);
    expect(mutation?.data).toMatchObject({ deleted: true, payers: [], splits: [] });

    s.store.applyPushResults([
      rejected(
        mutation!.id,
        serverExpense(s, expense.id, {
          version: 2,
          title: 'Cena editada',
          payers: expense.payers.map((p) => ({ id: p.id, memberId: p.memberId })),
          splits: expense.splits.map((p) => ({ id: p.id, memberId: p.memberId })),
        }),
      ),
    ]);

    const local = s.repos.expenses.get(expense.id);
    expect(local).toMatchObject({ title: 'Cena editada' });
    expect(local?.payers).toHaveLength(1);
    expect(local?.splits).toHaveLength(2);
    expect(listConflicts(s.db)).toMatchObject([
      { entity: 'expense', wasDeletion: true, serverDeleted: false },
    ]);
  });

  it('gasto nuevo sin respuesta del servidor: sale de los movimientos y queda completo en el borrador', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    const expense = dinner(s);
    const [mutation] = s.store.nextBatch(BIG);
    expect(mutation).toMatchObject({ entity: 'expense', base: null });

    const notices = s.store.applyPushResults([
      rejected(mutation!.id, [], 'group_currency_changed'),
    ]);

    expect(s.repos.expenses.get(expense.id)).toBeUndefined();
    expect(s.repos.expenses.listByGroup(s.group.id)).toEqual([]);
    const [draft] = listConflicts(s.db);
    expect(draft).toMatchObject({
      reason: 'group_currency_changed',
      wasNew: true,
      serverDeleted: false,
      wasDeletion: false,
      data: mutation!.data,
    });
    const data = draft!.data as { payers: unknown[]; splits: unknown[]; title: string };
    expect(data.title).toBe('Cena');
    expect(data.payers).toHaveLength(1);
    expect(data.splits).toHaveLength(2);
    expect(notices).toMatchObject([{ wasNew: true, reason: 'group_currency_changed' }]);
    // No vuelve a enviarse: ya no es un cambio pendiente.
    expect(listPendingUnits(s.db)).toEqual([]);
    expect(s.store.nextBatch(BIG)).toEqual([]);
  });

  it('nunca borra sin dejar un borrador: un rechazo, un borrador', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    dinner(s, 1000);
    dinner(s, 2000);
    const batch = s.store.nextBatch(BIG);
    s.store.applyPushResults(batch.map((m) => rejected(m.id, [], 'group_currency_changed')));
    expect(listConflicts(s.db)).toHaveLength(2);
    expect(s.repos.expenses.listByGroup(s.group.id)).toEqual([]);
  });

  it('si no puede aplicar lo del servidor, no pierde nada: el envío queda apartado y lo tuyo intacto', async () => {
    const s = await setupSync();
    const expense = dinner(s);
    markEverythingSynced(s);
    s.repos.expenses.update(expense.id, expense.version, {
      groupId: s.group.id,
      title: 'Cena rica',
      amount: 3000,
      currency: 'USD',
      payers: [{ memberId: s.ids[0] as string, amount: 3000 }],
      split: { method: 'equal', participants: [s.ids[0] as string] },
      occurredOn: '2026-10-09',
    });
    const [mutation] = s.store.nextBatch(BIG);
    const unknownMember = '01990000-0000-7000-8000-0000000000ff';
    const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    const notices = s.store.applyPushResults([
      rejected(
        mutation!.id,
        serverExpense(s, expense.id, {
          version: 2,
          title: 'Cena (otro)',
          payers: [{ id: '01990000-0000-7000-8000-0000000000a1', memberId: unknownMember }],
          splits: [{ id: '01990000-0000-7000-8000-0000000000b1', memberId: unknownMember }],
        }),
      ),
    ]);

    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
    expect(notices).toEqual([]);
    expect(s.repos.expenses.get(expense.id)).toMatchObject({ title: 'Cena rica' });
    expect(rows(s, `SELECT state, fail_reason FROM sync_outbox`)).toEqual([
      { state: 'failed', fail_reason: 'error' },
    ]);
    expect(s.store.counts()).toEqual({ pending: 0, failed: 1, conflicts: 0, lost: 0 });
    expect(s.store.nextBatch(BIG)).toEqual([]);
  });
});

describe('applyPushResults: motivos de la 4b (member_linked y quota)', () => {
  it('borrar un miembro con cuenta y acceso: el miembro vuelve como está en el servidor y queda un borrador', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    const beto = s.repos.members.listByGroup(s.group.id)[1]!;
    s.repos.members.remove(beto.id, beto.version);
    const batch = s.store.nextBatch(BIG);
    const mutation = batch.find((m) => m.entity === 'member')!;
    expect(mutation.data).toMatchObject({ id: beto.id, deleted: true });

    const notices = s.store.applyPushResults([
      rejected(
        mutation.id,
        [
          serverRow('group_members', {
            id: beto.id,
            group_id: s.group.id,
            user_id: '01990000-0000-7000-8000-0000000000aa',
            display_name: 'Beto',
            role: 'member',
            version: 1,
          }),
        ],
        'member_linked',
      ),
    ]);

    expect(s.repos.members.listByGroup(s.group.id).map((m) => m.displayName)).toContain('Beto');
    expect(listConflicts(s.db)).toMatchObject([
      { entity: 'member', reason: 'member_linked', wasDeletion: true, wasNew: false },
    ]);
    expect(notices).toMatchObject([{ reason: 'member_linked', label: 'Beto' }]);
    expect(notices[0]?.quota).toBeUndefined();
  });

  it('cupo de miembros: el miembro nuevo sale de la vista y queda en el borrador con el cupo', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    const nuevo = s.repos.members.add(s.group.id, 'Dani');
    const batch = s.store.nextBatch(BIG);
    const mutation = batch.find((m) => m.entity === 'member')!;
    expect(mutation).toMatchObject({ base: null, data: { id: nuevo.id } });

    const notices = s.store.applyPushResults([rejected(mutation.id, [], 'quota', 'members')]);

    expect(s.repos.members.listByGroup(s.group.id).map((m) => m.id)).not.toContain(nuevo.id);
    expect(listConflicts(s.db)).toMatchObject([
      { entity: 'member', reason: 'quota', quota: 'members', wasNew: true },
    ]);
    expect(notices).toMatchObject([
      { reason: 'quota', quota: 'members', wasNew: true, label: 'Dani' },
    ]);
    // No vuelve a enviarse.
    expect(listPendingUnits(s.db)).toEqual([]);
    expect(s.store.nextBatch(BIG)).toEqual([]);
  });

  it('cupo de categorías: la categoría nueva sale de la vista y queda en el borrador', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    const categoryId = '01990000-0000-7000-8000-0000000000c1';
    s.sqlite.run(
      `INSERT INTO categories (id, created_at, updated_at, group_id, name, icon)
       VALUES ('${categoryId}', 1, 1, '${s.group.id}', 'Snacks', 'cookie')`,
    );
    const mutation = s.store.nextBatch(BIG).find((m) => m.entity === 'category')!;

    s.store.applyPushResults([rejected(mutation.id, [], 'quota', 'categories')]);

    expect(
      rows(s, `SELECT deleted_at IS NOT NULL AS gone FROM categories WHERE id = '${categoryId}'`),
    ).toEqual([{ gone: 1 }]);
    expect(listConflicts(s.db)).toMatchObject([
      { entity: 'category', reason: 'quota', quota: 'categories' },
    ]);
    expect(s.store.nextBatch(BIG)).toEqual([]);
  });

  it('cupo de grupos: el grupo nuevo y todo lo que colgaba de él salen de la vista y no se envían', async () => {
    const s = await setupSync();
    dinner(s);
    // Nada se ha subido: el grupo, sus miembros y el gasto son nuevos.
    const mutation = s.store.nextBatch(BIG).find((m) => m.entity === 'group')!;
    expect(mutation).toMatchObject({ base: null });

    s.store.applyPushResults([rejected(mutation.id, [], 'quota', 'groups')]);

    expect(rows(s, `SELECT deleted_at IS NOT NULL AS gone FROM groups`)).toEqual([{ gone: 1 }]);
    expect(rows(s, `SELECT count(*) AS n FROM group_members WHERE deleted_at IS NULL`)).toEqual([
      { n: 0 },
    ]);
    expect(rows(s, `SELECT count(*) AS n FROM expenses WHERE deleted_at IS NULL`)).toEqual([
      { n: 0 },
    ]);
    expect(listConflicts(s.db)).toMatchObject([
      { entity: 'group', reason: 'quota', quota: 'groups' },
    ]);
    // Nada más sale: ni los miembros ni el gasto, que dependían de un grupo que no existe.
    const rest = s.store
      .nextBatch(BIG)
      .filter((m) => m.id !== mutation.id)
      .map((m) => m.entity);
    expect(rest).toEqual([]);
  });

  it('el motivo y el cupo se guardan en el borrador y se leen de vuelta', async () => {
    const s = await setupSync();
    markEverythingSynced(s);
    s.repos.members.add(s.group.id, 'Eli');
    const mutation = s.store.nextBatch(BIG).find((m) => m.entity === 'member')!;
    s.store.applyPushResults([rejected(mutation.id, [], 'quota', 'members')]);
    const [draft] = s.store.listConflicts();
    expect(s.store.getConflict(draft!.id)).toMatchObject({ reason: 'quota', quota: 'members' });
  });
});

describe('applyPushResults: fallido y reintento', () => {
  it('aparta el envío con su motivo y su campo, y no frena los demás', async () => {
    const s = await setupSync();
    const batch = s.store.nextBatch(BIG);
    const [group, bad, ...others] = batch;

    s.store.applyPushResults([
      applied(group!.id, 1),
      failed(bad!.id, 'invalid', 'display_name'),
      ...others.map((m) => applied(m.id, 1)),
    ]);

    expect(rows(s, `SELECT entity_id, state, fail_reason, fail_field FROM sync_outbox`)).toEqual([
      {
        entity_id: bad!.data.id,
        state: 'failed',
        fail_reason: 'invalid',
        fail_field: 'display_name',
      },
    ]);
    expect(s.store.counts()).toEqual({ pending: 0, failed: 1, conflicts: 0, lost: 0 });
    // Queda fuera de los lotes aunque siga siendo un cambio pendiente.
    expect(listPendingUnits(s.db).map((u) => u.id)).toEqual([bad!.data.id]);
    expect(s.store.nextBatch(BIG)).toEqual([]);
  });

  it('retryFailed devuelve los apartados a la cola con un envío nuevo', async () => {
    const s = await setupSync();
    const batch = s.store.nextBatch(BIG);
    s.store.applyPushResults(batch.map((m) => failed(m.id, 'forbidden')));
    expect(s.store.counts()).toMatchObject({ pending: 0, failed: 4 });

    expect(s.store.retryFailed()).toBe(4);
    expect(s.store.counts()).toMatchObject({ pending: 4, failed: 0 });
    const again = s.store.nextBatch(BIG);
    expect(again).toHaveLength(4);
    expect(again.map((m) => m.id).sort()).not.toEqual(batch.map((m) => m.id).sort());
    expect(s.store.retryFailed()).toBe(0);
  });
});

describe('counts', () => {
  it('cuenta pendientes, apartados y borradores', async () => {
    const s = await setupSync();
    expect(s.store.counts()).toEqual({ pending: 4, failed: 0, conflicts: 0, lost: 0 });
    markEverythingSynced(s);
    expect(s.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0, lost: 0 });
  });
});
