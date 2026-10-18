import { DEFAULT_GROUP_COLOR } from '@/lib/group-appearance';
import { createIdGenerator } from '@/lib/ids';
import { logger } from '@/lib/logger';

import type { DataChange } from '../../changes';
import { OTHER_CATEGORY_ID } from '../../repositories';
import { createTestRepositories } from '../../test-utils';
import { iso, rows, serverRow } from '../test-fixtures';
import { forgetGroupDownload } from '../pull';
import { createSyncStore } from '../store';
import type { PullCursorObject, PulledGroup, PullResponse, RemoteRow } from '../wire';

const id = (n: number) => `01990000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const GROUP = id(1);
const ANA = id(2);
const BETO = id(3);
const CARLA = id(4);
const EXPENSE = id(10);
const PAYER = id(11);
const SPLIT_ANA = id(12);
const SPLIT_BETO = id(13);
const OWNER = id(100); // la cuenta dueña del grupo, ajena a este teléfono

beforeEach(() => {
  jest.spyOn(logger, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Un dispositivo con la cuenta de Ana ya iniciada (el usuario local). */
async function setup() {
  const ctx = await createTestRepositories();
  const me = ctx.repos.profile.ensure('Ana');
  let time = 1_770_000_000_000;
  const now = () => (time += 1);
  const newId = createIdGenerator({ now, randomBytes: (n) => new Uint8Array(n).fill(9) });
  const store = createSyncStore(ctx.db, ctx.bus, { now, newId });
  const changes: DataChange[] = [];
  ctx.bus.subscribe((change) => changes.push(change));
  return { ...ctx, me, store, changes };
}
type Setup = Awaited<ReturnType<typeof setup>>;

// Una unidad de cada tabla, en el orden del servidor (t = 1 groups, 2 access, 3 members...).
const groupRow = (createdBy: string): RemoteRow =>
  serverRow('groups', {
    id: GROUP,
    name: 'Viaje',
    currency: 'USD',
    created_by: createdBy,
    emoji: null,
    color: DEFAULT_GROUP_COLOR,
    archived_at: null,
  });
const accessRow = (
  accessId: string,
  userId: string,
  role: 'owner' | 'member',
  over: Record<string, unknown> = {},
): RemoteRow =>
  serverRow('group_access', {
    id: accessId,
    group_id: GROUP,
    user_id: userId,
    role,
    invitation_id: null,
    ...over,
  });
const memberRow = (memberId: string, name: string, userId: string | null): RemoteRow =>
  serverRow('group_members', {
    id: memberId,
    group_id: GROUP,
    user_id: userId,
    display_name: name,
    role: 'member',
  });
const expenseRows = (title = 'Cena'): RemoteRow[] => [
  serverRow('expenses', {
    id: EXPENSE,
    group_id: GROUP,
    kind: 'expense',
    title,
    amount: 3000,
    currency: 'USD',
    group_currency: 'USD',
    group_amount: 3000,
    exchange_rate: '1',
    rate_date: null,
    split_method: 'equal',
    category_id: OTHER_CATEGORY_ID,
    occurred_on: '2026-10-09',
    notes: null,
  }),
  serverRow('expense_payers', {
    id: PAYER,
    group_id: GROUP,
    expense_id: EXPENSE,
    member_id: ANA,
    amount: 3000,
    group_amount: 3000,
  }),
  serverRow('expense_splits', {
    id: SPLIT_ANA,
    group_id: GROUP,
    expense_id: EXPENSE,
    member_id: ANA,
    amount: 1500,
    group_amount: 1500,
    input_value: null,
  }),
  serverRow('expense_splits', {
    id: SPLIT_BETO,
    group_id: GROUP,
    expense_id: EXPENSE,
    member_id: BETO,
    amount: 1500,
    group_amount: 1500,
    input_value: null,
  }),
];

/** Las filas de un grupo compartido: el dueño es una cuenta ajena, Ana (yo) entró por invitación. */
function sharedRows(s: Setup): RemoteRow[] {
  return [
    groupRow(OWNER),
    accessRow(id(50), OWNER, 'owner'),
    accessRow(id(51), s.me.id, 'member', { invitation_id: id(60) }),
    memberRow(ANA, 'Ana', s.me.id),
    memberRow(BETO, 'Beto', null),
    ...expenseRows(),
  ];
}

const entire = (rowsOf: readonly RemoteRow[], cursor = 7): PulledGroup => ({
  id: GROUP,
  cursor,
  partial: false,
  next: null,
  rows: rowsOf,
});
const partial = (rowsOf: readonly RemoteRow[], next: PullCursorObject): PulledGroup => ({
  id: GROUP,
  cursor: null,
  partial: true,
  next,
  rows: rowsOf,
});
const response = (groups: PulledGroup[], lost: string[] = [], hasMore = false): PullResponse => ({
  groups,
  hasMore,
  lost,
});
const next = (seq: number, hw: number, t: number, afterId: string): PullCursorObject => ({
  seq,
  hw,
  after: { t, id: afterId },
});

const count = (s: Setup, table: string) =>
  (s.sqlite.exec(`SELECT count(*) FROM ${table}`)[0]?.values[0]?.[0] as number) ?? 0;
const cursorState = (s: Setup) =>
  rows(
    s,
    `SELECT group_id, cursor, round_seq, hw, after_t, after_id, staged FROM sync_cursors ORDER BY group_id`,
  );

describe('applyPull: grupo compartido con cuentas ajenas', () => {
  it('guarda las cuentas ajenas como usuarios remotos mínimos y aplica el grupo', () => {
    return setup().then((s) => {
      const outcome = s.store.applyPull(response([entire(sharedRows(s))]));

      expect(outcome.held).toEqual([]);
      expect(rows(s, `SELECT id, is_remote FROM users`)).toEqual(
        expect.arrayContaining([
          { id: s.me.id, is_remote: 0 },
          { id: OWNER, is_remote: 1 },
        ]),
      );
      expect(count(s, 'users')).toBe(2);
      expect(rows(s, `SELECT created_by FROM groups`)).toEqual([{ created_by: OWNER }]);
      expect(count(s, 'group_members')).toBe(2);
      expect(count(s, 'expenses')).toBe(1);
      expect(s.store.cursors()).toEqual({ [GROUP]: 7 });
      expect(s.sqlite.exec('PRAGMA foreign_key_check')).toEqual([]);
    });
  });

  it('el usuario remoto no es el local ni se muestra: nombre de relleno', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    expect(rows(s, `SELECT display_name, email FROM users WHERE id = '${OWNER}'`)).toEqual([
      { display_name: '?', email: null },
    ]);
  });

  it('guarda las filas de group_access con el rol, la invitación y la versión del servidor', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    expect(
      rows(
        s,
        `SELECT id, user_id, role, invitation_id, deleted_at, version FROM group_access ORDER BY id`,
      ),
    ).toEqual([
      {
        id: id(50),
        user_id: OWNER,
        role: 'owner',
        invitation_id: null,
        deleted_at: null,
        version: 1,
      },
      {
        id: id(51),
        user_id: s.me.id,
        role: 'member',
        invitation_id: id(60),
        deleted_at: null,
        version: 1,
      },
    ]);
  });

  it('nada del acceso queda como pendiente de subir', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    expect(s.store.counts()).toMatchObject({ pending: 0, failed: 0, conflicts: 0, lost: 0 });
  });

  it('una fila de acceso más nueva reemplaza a la vieja; una más vieja no', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    const gone = accessRow(id(51), s.me.id, 'member', {
      version: 3,
      deleted_at: iso(1_790_000_009_000),
    });
    s.store.applyPull(response([entire([gone], 9)]));
    expect(rows(s, `SELECT version, deleted_at FROM group_access WHERE id = '${id(51)}'`)).toEqual([
      { version: 3, deleted_at: expect.any(Number) },
    ]);
    s.store.applyPull(
      response([entire([accessRow(id(51), s.me.id, 'member', { version: 2 })], 10)]),
    );
    expect(rows(s, `SELECT version FROM group_access WHERE id = '${id(51)}'`)).toEqual([
      { version: 3 },
    ]);
  });

  it('si el servidor recrea el acceso de una cuenta con otro id, queda una sola fila', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    s.store.applyPull(
      response([entire([accessRow(id(70), s.me.id, 'member', { version: 1 })], 12)]),
    );
    expect(rows(s, `SELECT id FROM group_access WHERE user_id = '${s.me.id}' ORDER BY id`)).toEqual(
      [{ id: id(70) }],
    );
  });

  it('avisa por el bus de que cambió group_access', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    expect(s.changes.some((change) => change.tables.has('group_access'))).toBe(true);
  });

  it('una fila de acceso inválida deja el grupo retenido y no avanza el cursor', async () => {
    const s = await setup();
    const bad = accessRow(id(51), s.me.id, 'member', { role: 'admin' });
    const outcome = s.store.applyPull(
      response([entire([...sharedRows(s).filter((r) => r.table !== 'group_access'), bad])]),
    );
    expect(outcome.held).toEqual([{ id: GROUP, cursor: 7 }]);
    expect(s.store.cursors()).toEqual({});
  });
});

describe('applyPull: C4, el id no cambia de grupo ni de gasto', () => {
  it('un miembro cuyo id ya existe en otro grupo no se aplica y el grupo queda retenido', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    const other = id(2000);
    s.sqlite.run(
      `INSERT INTO groups (id, created_at, updated_at, name, currency, created_by)
       VALUES ('${other}', 1, 1, 'Otro', 'USD', '${s.me.id}')`,
    );
    const stolen = serverRow('group_members', {
      id: BETO,
      group_id: other,
      user_id: null,
      display_name: 'Robado',
      role: 'member',
      version: 5,
    });
    const outcome = s.store.applyPull({
      groups: [{ id: other, cursor: 3, partial: false, next: null, rows: [stolen] }],
      hasMore: false,
      lost: [],
    });
    expect(outcome.held).toEqual([{ id: other, cursor: 3 }]);
    expect(
      rows(s, `SELECT group_id, display_name FROM group_members WHERE id = '${BETO}'`),
    ).toEqual([{ group_id: GROUP, display_name: 'Beto' }]);
  });

  it('un pagador o una parte cuyo id ya existe en otro gasto no se aplica', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    const second = id(11000);
    const rowsBad = [
      serverRow('expenses', {
        id: second,
        group_id: GROUP,
        kind: 'expense',
        title: 'Otro',
        amount: 1000,
        currency: 'USD',
        group_currency: 'USD',
        group_amount: 1000,
        exchange_rate: '1',
        rate_date: null,
        split_method: 'equal',
        category_id: OTHER_CATEGORY_ID,
        occurred_on: '2026-10-09',
        notes: null,
      }),
      // El id del pagador de EXPENSE, ahora dentro de otro gasto.
      serverRow('expense_payers', {
        id: PAYER,
        group_id: GROUP,
        expense_id: second,
        member_id: ANA,
        amount: 1000,
        group_amount: 1000,
      }),
    ];
    const outcome = s.store.applyPull(response([entire(rowsBad, 9)]));
    expect(outcome.held).toEqual([{ id: GROUP, cursor: 9 }]);
    expect(rows(s, `SELECT expense_id FROM expense_payers WHERE id = '${PAYER}'`)).toEqual([
      { expense_id: EXPENSE },
    ]);
  });
});

describe('applyPull: descarga de un grupo grande por páginas', () => {
  const FIRST = [groupRow(OWNER), accessRow(id(50), OWNER, 'owner')];
  const SECOND_PAGE = (s: Setup) => [
    accessRow(id(51), s.me.id, 'member'),
    memberRow(ANA, 'Ana', s.me.id),
    memberRow(BETO, 'Beto', null),
  ];

  it('las páginas parciales esperan en sync_pull_pages y no tocan las tablas del grupo', async () => {
    const s = await setup();
    const outcome = s.store.applyPull(response([partial(FIRST, next(0, 40, 2, id(50)))], [], true));

    expect(outcome).toEqual({ applied: 0, skipped: 0, held: [], lost: [], more: false });
    expect(count(s, 'groups')).toBe(0);
    expect(count(s, 'sync_pull_pages')).toBe(1);
    expect(cursorState(s)).toEqual([
      {
        group_id: GROUP,
        cursor: 0,
        round_seq: 0,
        hw: 40,
        after_t: 2,
        after_id: id(50),
        staged: 0,
      },
    ]);
    expect(s.store.cursors()).toEqual({ [GROUP]: 0 });
  });

  it('mientras dura, pullCursors manda el objeto con seq, hw y after', async () => {
    const s = await setup();
    s.store.applyPull(response([partial(FIRST, next(0, 40, 2, id(50)))], [], true));
    expect(s.store.pullCursors()).toEqual({
      [GROUP]: { seq: 0, hw: 40, after: { t: 2, id: id(50) } },
    });
  });

  it('con la última página no aplica todavía: espera la ronda extra desde hw', async () => {
    const s = await setup();
    s.store.applyPull(response([partial(FIRST, next(0, 40, 2, id(50)))], [], true));
    const outcome = s.store.applyPull(
      response([partial(SECOND_PAGE(s), next(0, 40, 3, BETO))], [], true),
    );
    expect(outcome.held).toEqual([]);
    const last = s.store.applyPull(response([entire(expenseRows(), 40)]));

    // La página final (no parcial) se guarda y pide la ronda extra: ahora se manda hw como entero.
    expect(last).toEqual({ applied: 0, skipped: 0, held: [], lost: [], more: true });
    expect(count(s, 'groups')).toBe(0);
    expect(count(s, 'sync_pull_pages')).toBe(3);
    expect(cursorState(s)[0]).toMatchObject({ cursor: 0, hw: 40, staged: 1 });
    expect(s.store.pullCursors()).toEqual({ [GROUP]: 40 });
  });

  it('la ronda extra aplica todas las páginas juntas, avanza el cursor y limpia el estado', async () => {
    const s = await setup();
    s.store.applyPull(response([partial(FIRST, next(0, 40, 2, id(50)))], [], true));
    s.store.applyPull(response([partial(SECOND_PAGE(s), next(0, 40, 3, BETO))], [], true));
    s.store.applyPull(response([entire(expenseRows(), 40)]));

    // La ronda desde hw trae lo que cambió mientras bajaba: se aplica junto con lo guardado.
    const final = s.store.applyPull(response([entire([memberRow(BETO, 'Beto Pérez', null)], 43)]));

    expect(final.held).toEqual([]);
    expect(final.applied).toBeGreaterThan(0);
    expect(count(s, 'groups')).toBe(1);
    expect(count(s, 'expenses')).toBe(1);
    expect(rows(s, `SELECT display_name FROM group_members WHERE id = '${BETO}'`)).toEqual([
      { display_name: 'Beto Pérez' },
    ]);
    expect(s.store.cursors()).toEqual({ [GROUP]: 43 });
    expect(count(s, 'sync_pull_pages')).toBe(0);
    expect(cursorState(s)).toEqual([
      {
        group_id: GROUP,
        cursor: 43,
        round_seq: null,
        hw: null,
        after_t: null,
        after_id: null,
        staged: 0,
      },
    ]);
    expect(s.store.pullCursors()).toEqual({ [GROUP]: 43 });
  });

  it('si la ronda extra no trae nada del grupo, igual se aplica lo guardado con cursor hw', async () => {
    const s = await setup();
    s.store.applyPull(response([partial(FIRST, next(0, 40, 2, id(50)))], [], true));
    s.store.applyPull(response([partial(SECOND_PAGE(s), next(0, 40, 3, BETO))], [], true));
    s.store.applyPull(response([entire(expenseRows(), 40)]));

    const final = s.store.applyPull(response([]));

    expect(final.held).toEqual([]);
    expect(count(s, 'expenses')).toBe(1);
    expect(s.store.cursors()).toEqual({ [GROUP]: 40 });
    expect(count(s, 'sync_pull_pages')).toBe(0);
  });

  it('si la ronda extra es otra página parcial, la ronda nueva sigue desde hw y todo se aplica al final', async () => {
    const s = await setup();
    s.store.applyPull(response([partial(FIRST, next(0, 40, 2, id(50)))], [], true));
    s.store.applyPull(response([partial(SECOND_PAGE(s), next(0, 40, 3, BETO))], [], true));
    s.store.applyPull(response([entire(expenseRows(), 40)]));

    // Desde hw (40) otro lote grande: nueva ronda con seq 40 y hw 90.
    s.store.applyPull(
      response([partial([memberRow(CARLA, 'Carla', null)], next(40, 90, 3, CARLA))], [], true),
    );
    expect(cursorState(s)[0]).toMatchObject({
      cursor: 0,
      round_seq: 40,
      hw: 90,
      after_t: 3,
      after_id: CARLA,
      staged: 0,
    });
    expect(s.store.pullCursors()).toEqual({
      [GROUP]: { seq: 40, hw: 90, after: { t: 3, id: CARLA } },
    });
    s.store.applyPull(response([entire([], 90)]));
    expect(s.store.pullCursors()).toEqual({ [GROUP]: 90 });
    s.store.applyPull(response([]));

    expect(count(s, 'group_members')).toBe(3);
    expect(s.store.cursors()).toEqual({ [GROUP]: 90 });
  });

  it('si algo no se puede aplicar, descarta las páginas, no avanza el cursor y reintenta desde cero', async () => {
    const s = await setup();
    s.store.applyPull(response([partial(FIRST, next(0, 40, 2, id(50)))], [], true));
    // Falta el miembro Beto, que el gasto necesita.
    s.store.applyPull(
      response([partial([memberRow(ANA, 'Ana', s.me.id)], next(0, 40, 3, ANA))], [], true),
    );
    s.store.applyPull(response([entire(expenseRows(), 40)]));
    const final = s.store.applyPull(response([]));

    expect(final.held).toEqual([{ id: GROUP, cursor: 40 }]);
    expect(count(s, 'sync_pull_pages')).toBe(0);
    expect(cursorState(s)).toEqual([
      {
        group_id: GROUP,
        cursor: 0,
        round_seq: null,
        hw: null,
        after_t: null,
        after_id: null,
        staged: 0,
      },
    ]);
    // El grupo y lo que sí entró quedan; el cursor sigue en 0 y la próxima ronda empieza de nuevo.
    expect(s.store.pullCursors()).toEqual({ [GROUP]: 0 });
  });

  it('un next que no sigue donde íbamos descarta lo guardado y deja el grupo retenido', async () => {
    const s = await setup();
    s.store.applyPull(response([partial(FIRST, next(0, 40, 2, id(50)))], [], true));
    // El servidor cambia de hw a mitad de camino: no es la misma descarga.
    const outcome = s.store.applyPull(
      response([partial(SECOND_PAGE(s), next(0, 99, 3, BETO))], [], true),
    );
    expect(outcome.held).toEqual([{ id: GROUP, cursor: null }]);
    expect(count(s, 'sync_pull_pages')).toBe(0);
    expect(s.store.pullCursors()).toEqual({ [GROUP]: 0 });
  });

  it('la primera página de un grupo que ya tenía cursor sigue desde ese cursor', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s), 7)]));
    s.store.applyPull(response([partial([], next(7, 30, 5, EXPENSE))], [], true));
    expect(s.store.pullCursors()).toEqual({
      [GROUP]: { seq: 7, hw: 30, after: { t: 5, id: EXPENSE } },
    });
    expect(s.store.cursors()).toEqual({ [GROUP]: 7 });
  });

  it('una página con seq distinto al esperado no se acepta', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s), 7)]));
    const outcome = s.store.applyPull(response([partial([], next(3, 30, 5, EXPENSE))], [], true));
    expect(outcome.held).toEqual([{ id: GROUP, cursor: null }]);
    expect(count(s, 'sync_pull_pages')).toBe(0);
  });
});

describe('applyPull: acceso perdido (lost)', () => {
  async function withGroup() {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    return s;
  }

  it('marca access_lost_at, conserva todos los datos y deja de pedir ese grupo', async () => {
    const s = await withGroup();
    const outcome = s.store.applyPull(response([], [GROUP]));

    expect(outcome.lost).toEqual([GROUP]);
    expect(rows(s, `SELECT access_lost_at FROM groups`)).toEqual([
      { access_lost_at: expect.any(Number) },
    ]);
    expect(count(s, 'expenses')).toBe(1);
    expect(count(s, 'group_members')).toBe(2);
    expect(s.store.pullCursors()).toEqual({});
    expect(count(s, 'sync_cursors')).toBe(0);
  });

  it('avisa por el bus del grupo', async () => {
    const s = await withGroup();
    s.changes.length = 0;
    s.store.applyPull(response([], [GROUP]));
    expect(s.changes.some((change) => change.groupIds?.has(GROUP))).toBe(true);
  });

  it('un grupo perdido que el teléfono no tiene se ignora', async () => {
    const s = await setup();
    const outcome = s.store.applyPull(response([], [id(999)]));
    expect(outcome.lost).toEqual([]);
  });

  it('descarta la descarga en curso del grupo perdido', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    s.store.applyPull(response([partial([], next(7, 30, 5, EXPENSE))], [], true));
    s.store.applyPull(response([], [GROUP]));
    expect(count(s, 'sync_pull_pages')).toBe(0);
    expect(count(s, 'sync_cursors')).toBe(0);
  });

  it('lo pendiente de un grupo perdido no se envía y se cuenta aparte', async () => {
    const s = await withGroup();
    // Un cambio del usuario sin subir.
    s.sqlite.run(`UPDATE expenses SET title = 'Cena editada', version = version + 1`);
    expect(s.store.counts()).toMatchObject({ pending: 1, lost: 0 });
    expect(s.store.nextBatch({ count: 50, bytes: 100_000 })).toHaveLength(1);
    s.sqlite.run(`DELETE FROM sync_outbox`);

    s.store.applyPull(response([], [GROUP]));

    expect(s.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0, lost: 1 });
    expect(s.store.nextBatch({ count: 50, bytes: 100_000 })).toEqual([]);
    expect(count(s, 'sync_outbox')).toBe(0);
  });

  it('un envío que ya estaba en vuelo de un grupo perdido tampoco sale', async () => {
    const s = await withGroup();
    s.sqlite.run(`UPDATE expenses SET title = 'Cena editada', version = version + 1`);
    expect(s.store.nextBatch({ count: 50, bytes: 100_000 })).toHaveLength(1);
    s.store.applyPull(response([], [GROUP]));
    expect(s.store.nextBatch({ count: 50, bytes: 100_000 })).toEqual([]);
    expect(s.store.counts()).toMatchObject({ pending: 0, lost: 1 });
  });

  it('si el servidor vuelve a mandar el grupo, se limpia access_lost_at y lo pendiente vuelve a salir', async () => {
    const s = await withGroup();
    s.sqlite.run(`UPDATE expenses SET title = 'Cena editada', version = version + 1`);
    s.store.applyPull(response([], [GROUP]));
    expect(s.store.counts()).toMatchObject({ pending: 0, lost: 1 });

    // Entró de nuevo con otra invitación: la descarga llega desde 0.
    s.store.applyPull(response([entire(sharedRows(s), 12)]));

    expect(rows(s, `SELECT access_lost_at FROM groups`)).toEqual([{ access_lost_at: null }]);
    expect(s.store.counts()).toMatchObject({ pending: 1, lost: 0 });
    // El cambio local sigue ahí: el servidor no lo pisa.
    expect(rows(s, `SELECT title FROM expenses`)).toEqual([{ title: 'Cena editada' }]);
  });

  it('los borradores de un grupo perdido se conservan', async () => {
    const s = await withGroup();
    s.sqlite.run(
      `INSERT INTO sync_conflicts (id, entity, entity_id, group_id, reason, data, created_at)
       VALUES ('d1', 'expense', '${EXPENSE}', '${GROUP}', 'conflict', '{}', 1)`,
    );
    s.store.applyPull(response([], [GROUP]));
    expect(s.store.counts()).toMatchObject({ conflicts: 1 });
  });
});

describe('applyPull: estadísticas y errores', () => {
  it('cuenta lo aplicado y lo saltado por cambios locales pendientes', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s))]));
    s.sqlite.run(`UPDATE expenses SET title = 'Local', version = version + 1`);
    const outcome = s.store.applyPull(
      response([
        entire(
          [...expenseRows('Del servidor').map((r) => ({ ...r, row: { ...r.row, version: 4 } }))],
          9,
        ),
      ]),
    );
    expect(outcome.skipped).toBe(1);
    expect(rows(s, `SELECT title FROM expenses`)).toEqual([{ title: 'Local' }]);
  });

  it('un grupo retenido por filas inválidas informa su cursor para no repetirlo en el ciclo', async () => {
    const s = await setup();
    const bad = serverRow('group_members', {
      id: BETO,
      group_id: GROUP,
      user_id: null,
      display_name: '',
      role: 'member',
    });
    const outcome = s.store.applyPull(response([entire([groupRow(OWNER), bad], 5)]));
    expect(outcome.held).toEqual([{ id: GROUP, cursor: 5 }]);
  });
});

describe('forgetGroupDownload', () => {
  it('borra el cursor y las páginas guardadas del grupo, y el servidor lo manda desde 0', async () => {
    const s = await setup();
    s.store.applyPull(response([entire(sharedRows(s), 7)]));
    s.store.applyPull(response([partial([], next(7, 30, 5, EXPENSE))], [], true));
    expect(count(s, 'sync_cursors')).toBe(1);
    expect(count(s, 'sync_pull_pages')).toBe(1);

    forgetGroupDownload(s.db, GROUP);

    expect(count(s, 'sync_cursors')).toBe(0);
    expect(count(s, 'sync_pull_pages')).toBe(0);
    expect(s.store.pullCursors()).toEqual({});
    // Los datos del grupo no se tocan.
    expect(count(s, 'expenses')).toBe(1);
  });

  it('no toca el cursor de otros grupos', async () => {
    const s = await setup();
    s.sqlite.run(
      `INSERT INTO sync_cursors (group_id, cursor, updated_at) VALUES ('${id(999)}', 4, 1)`,
    );
    forgetGroupDownload(s.db, GROUP);
    expect(s.store.cursors()).toEqual({ [id(999)]: 4 });
  });
});
