import { DEFAULT_GROUP_COLOR } from '@/lib/group-appearance';
import { createIdGenerator } from '@/lib/ids';
import { logger } from '@/lib/logger';

import type { DataChange } from '../../changes';
import { OTHER_CATEGORY_ID } from '../../repositories';
import { createTestRepositories } from '../../test-utils';
import { iso, rows, serverRow } from '../test-fixtures';
import { createSyncStore } from '../store';
import type { RemoteGroupChanges, RemoteRow } from '../wire';

const id = (n: number) => `01990000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const GROUP = id(1);
const ANA = id(2);
const BETO = id(3);
const EXPENSE = id(10);
const PAYER = id(11);
const SPLIT_ANA = id(12);
const SPLIT_BETO = id(13);
const TRANSFER = id(20);

const TABLES = [
  'groups',
  'group_members',
  'categories',
  'expenses',
  'expense_payers',
  'expense_splits',
  'transfers',
] as const;

// Las predefinidas (9) viven en la base desde la migración y no se descargan del servidor.
const DOWNLOADED_TABLES = TABLES.filter((table) => table !== 'categories');

beforeEach(() => {
  // Las fallas provocadas a propósito se registran; aquí no hacen ruido.
  jest.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Un dispositivo vacío: solo el usuario local, igual que tras iniciar sesión por primera vez. */
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

const dump = (s: Setup) =>
  Object.fromEntries(TABLES.map((table) => [table, rows(s, `SELECT * FROM ${table} ORDER BY id`)]));

interface Overrides {
  version?: number;
  title?: string;
  amount?: number;
  deleted?: boolean;
  payerMember?: string;
  payerId?: string;
}

/** Las filas del servidor de un grupo con dos miembros y un gasto, en orden padres → hijos. */
function groupRows(s: Setup, o: Overrides = {}): RemoteRow[] {
  const version = o.version ?? 1;
  const amount = o.amount ?? 3000;
  const deletedAt = o.deleted ? iso(1_790_000_005_000) : null;
  return [
    serverRow('groups', {
      id: GROUP,
      name: 'Viaje',
      currency: 'USD',
      created_by: s.me.id,
      emoji: null,
      color: DEFAULT_GROUP_COLOR,
      archived_at: null,
    }),
    serverRow('group_members', {
      id: ANA,
      group_id: GROUP,
      user_id: s.me.id,
      display_name: 'Ana',
      role: 'owner',
    }),
    serverRow('group_members', {
      id: BETO,
      group_id: GROUP,
      user_id: null,
      display_name: 'Beto',
      role: 'member',
    }),
    serverRow('expenses', {
      id: EXPENSE,
      group_id: GROUP,
      kind: 'expense',
      title: o.title ?? 'Cena',
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
      version,
      deleted_at: deletedAt,
    }),
    serverRow('expense_payers', {
      id: o.payerId ?? PAYER,
      group_id: GROUP,
      expense_id: EXPENSE,
      member_id: o.payerMember ?? ANA,
      amount,
      group_amount: amount,
      deleted_at: deletedAt,
    }),
    serverRow('expense_splits', {
      id: SPLIT_ANA,
      group_id: GROUP,
      expense_id: EXPENSE,
      member_id: ANA,
      amount: amount / 2,
      group_amount: amount / 2,
      input_value: null,
      deleted_at: deletedAt,
    }),
    serverRow('expense_splits', {
      id: SPLIT_BETO,
      group_id: GROUP,
      expense_id: EXPENSE,
      member_id: BETO,
      amount: amount / 2,
      group_amount: amount / 2,
      input_value: null,
      deleted_at: deletedAt,
    }),
    serverRow('transfers', {
      id: TRANSFER,
      group_id: GROUP,
      from_member_id: BETO,
      to_member_id: ANA,
      amount: 500,
      currency: 'USD',
      group_currency: 'USD',
      group_amount: 500,
      exchange_rate: '1',
      rate_date: null,
      occurred_on: '2026-10-10',
    }),
  ];
}

const page = (rowsOf: RemoteRow[], cursor = 7): RemoteGroupChanges => ({
  id: GROUP,
  cursor,
  rows: rowsOf,
});

const cursorRows = (s: Setup) => rows(s, `SELECT group_id, cursor FROM sync_cursors`);

describe('applyRemoteGroup: grupo nuevo', () => {
  it('inserta el grupo completo, lo deja al día y avanza el cursor', async () => {
    const s = await setup();
    const outcome = s.store.applyRemoteGroup(page(groupRows(s)));

    expect(outcome).toEqual({ applied: 5, skipped: 0, held: false });
    expect(s.store.cursors()).toEqual({ [GROUP]: 7 });
    expect(rows(s, `SELECT name, created_by FROM groups`)).toEqual([
      { name: 'Viaje', created_by: s.me.id },
    ]);
    expect(rows(s, `SELECT COUNT(*) AS n FROM group_members`)).toEqual([{ n: 2 }]);
    expect(rows(s, `SELECT title, amount, group_currency FROM expenses`)).toEqual([
      { title: 'Cena', amount: 3000, group_currency: 'USD' },
    ]);
    expect(rows(s, `SELECT COUNT(*) AS n FROM expense_splits`)).toEqual([{ n: 2 }]);
    expect(rows(s, `SELECT COUNT(*) AS n FROM transfers`)).toEqual([{ n: 1 }]);
    // Todo quedó al día con el servidor: nada que subir.
    for (const table of DOWNLOADED_TABLES) {
      expect(rows(s, `SELECT COUNT(*) AS n FROM ${table} WHERE version <> synced_version`)).toEqual(
        [{ n: 0 }],
      );
      expect(rows(s, `SELECT COUNT(*) AS n FROM ${table} WHERE server_version IS NULL`)).toEqual([
        { n: 0 },
      ]);
    }
    expect(s.store.counts()).toEqual({ pending: 0, failed: 0, conflicts: 0 });
  });

  it('un solo aviso en el bus con source "sync" y el grupo', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));

    expect(s.changes).toHaveLength(1);
    expect(s.changes[0]?.source).toBe('sync');
    expect([...(s.changes[0]?.groupIds ?? [])]).toEqual([GROUP]);
    expect(s.changes[0]?.tables.has('expenses')).toBe(true);
  });

  it('un hijo antes que su padre en la lista se aplica por el orden de tablas', async () => {
    const s = await setup();
    const outcome = s.store.applyRemoteGroup(page([...groupRows(s)].reverse()));

    expect(outcome).toMatchObject({ applied: 5, held: false });
    expect(rows(s, `SELECT COUNT(*) AS n FROM expense_payers`)).toEqual([{ n: 1 }]);
  });
});

describe('applyRemoteGroup: idempotencia y eco', () => {
  it('aplicar el mismo lote dos veces deja la base idéntica', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));
    const first = dump(s);
    s.changes.length = 0;

    const outcome = s.store.applyRemoteGroup(page(groupRows(s)));

    expect(outcome).toEqual({ applied: 0, skipped: 0, held: false });
    expect(dump(s)).toEqual(first);
    expect(s.store.cursors()).toEqual({ [GROUP]: 7 });
    expect(s.changes).toEqual([]);
  });

  it('el eco de lo propio (misma versión del servidor) no cambia nada', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));
    const before = dump(s);

    // El servidor devuelve lo que acabo de subir: misma versión, mismo contenido.
    s.store.applyRemoteGroup(page(groupRows(s), 8));

    expect(dump(s)).toEqual(before);
    expect(s.store.cursors()).toEqual({ [GROUP]: 8 });
  });

  it('una versión nueva con el mismo contenido solo actualiza server_version, sin subir version', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));
    s.changes.length = 0;

    const outcome = s.store.applyRemoteGroup(page(groupRows(s, { version: 2 }), 9));

    expect(outcome).toEqual({ applied: 0, skipped: 0, held: false });
    expect(rows(s, `SELECT version, synced_version, server_version FROM expenses`)).toEqual([
      { version: 1, synced_version: 1, server_version: 2 },
    ]);
    expect(s.changes).toEqual([]);
  });

  it('contenido distinto reemplaza la fila y sube version', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));

    const outcome = s.store.applyRemoteGroup(
      page(groupRows(s, { version: 2, title: 'Cena rica', amount: 4000 }), 9),
    );

    expect(outcome).toMatchObject({ applied: 1, held: false });
    expect(
      rows(s, `SELECT title, amount, version, synced_version, server_version FROM expenses`),
    ).toEqual([
      { title: 'Cena rica', amount: 4000, version: 2, synced_version: 2, server_version: 2 },
    ]);
    // Un formulario abierto sobre la versión 1 ya no puede guardar encima.
    expect(s.repos.expenses.get(EXPENSE)).toMatchObject({ title: 'Cena rica', version: 2 });
    expect(s.store.counts().pending).toBe(0);
  });

  it('un pagador reemplazado por otro miembro no choca con el índice único', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));

    // El servidor cambió quién pagó: otro id de pagador, otro miembro.
    const outcome = s.store.applyRemoteGroup(
      page(groupRows(s, { version: 2, payerMember: BETO, payerId: id(14) }), 9),
    );

    expect(outcome).toMatchObject({ held: false });
    expect(rows(s, `SELECT id, member_id FROM expense_payers WHERE deleted_at IS NULL`)).toEqual([
      { id: id(14), member_id: BETO },
    ]);
  });
});

describe('applyRemoteGroup: borrados lógicos', () => {
  it('el borrado del servidor se aplica como borrado lógico local', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));

    const outcome = s.store.applyRemoteGroup(page(groupRows(s, { version: 2, deleted: true }), 9));

    expect(outcome).toMatchObject({ applied: 1, held: false });
    // La fila sigue en SQLite, con deleted_at: no se borra físicamente.
    expect(rows(s, `SELECT deleted_at IS NOT NULL AS gone FROM expenses`)).toEqual([{ gone: 1 }]);
    expect(rows(s, `SELECT COUNT(*) AS n FROM expense_payers WHERE deleted_at IS NULL`)).toEqual([
      { n: 0 },
    ]);
    expect(s.repos.expenses.get(EXPENSE)).toBeUndefined();
  });

  it('un gasto que llega ya borrado se guarda borrado', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s, { deleted: true })));

    expect(rows(s, `SELECT deleted_at IS NOT NULL AS gone FROM expenses`)).toEqual([{ gone: 1 }]);
    expect(s.repos.expenses.listByGroup(GROUP)).toEqual([]);
  });
});

describe('applyRemoteGroup: cambios locales pendientes', () => {
  it('no pisa una unidad con cambios locales: conserva lo local, salta y avanza el cursor', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));
    const local = s.repos.expenses.get(EXPENSE)!;
    s.repos.expenses.update(EXPENSE, local.version, {
      groupId: GROUP,
      title: 'Cena local',
      amount: 3000,
      currency: 'USD',
      payers: [{ memberId: ANA, amount: 3000 }],
      split: { method: 'equal', participants: [ANA, BETO] },
      occurredOn: '2026-10-09',
    });
    expect(s.store.counts().pending).toBe(1);
    const mine = dump(s);

    const outcome = s.store.applyRemoteGroup(
      page(
        groupRows(s, { version: 2, title: 'Cena del otro', payerMember: BETO, payerId: id(14) }),
        9,
      ),
    );

    expect(outcome).toEqual({ applied: 0, skipped: 1, held: false });
    expect(dump(s)).toEqual(mine);
    expect(s.store.cursors()).toEqual({ [GROUP]: 9 });
    // Sigue pendiente: el envío saldrá con la base vieja y el servidor lo rechazará con borrador.
    expect(s.store.counts().pending).toBe(1);
  });

  it('las demás unidades del lote sí se aplican', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));
    s.repos.groups.rename(GROUP, 1, 'Playa');

    const changed = groupRows(s, { version: 2, title: 'Cena rica' }).map((r) =>
      r.table === 'groups'
        ? serverRow('groups', { ...r.row, name: 'Viaje del otro', version: 2 })
        : r,
    );
    const outcome = s.store.applyRemoteGroup(page(changed, 9));

    expect(outcome).toEqual({ applied: 1, skipped: 1, held: false });
    expect(rows(s, `SELECT name FROM groups`)).toEqual([{ name: 'Playa' }]);
    expect(rows(s, `SELECT title FROM expenses`)).toEqual([{ title: 'Cena rica' }]);
  });
});

describe('applyRemoteGroup: "soy yo" movido', () => {
  it('libera primero al miembro que lo tenía: no choca con el índice único', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s)));

    // El servidor movió la cuenta de Ana a Beto. Beto aparece primero en la lista.
    const moved = groupRows(s).map((r) => {
      if (r.table !== 'group_members') {
        return r;
      }
      return r.row.id === BETO
        ? serverRow('group_members', { ...r.row, user_id: s.me.id, version: 2 })
        : serverRow('group_members', { ...r.row, user_id: null, version: 2 });
    });
    const outcome = s.store.applyRemoteGroup(page([...moved].reverse(), 9));

    expect(outcome).toMatchObject({ applied: 2, held: false });
    expect(rows(s, `SELECT id FROM group_members WHERE user_id IS NOT NULL`)).toEqual([
      { id: BETO },
    ]);
  });
});

describe('applyRemoteGroup: padres que faltan', () => {
  it('una fila sin su padre se difiere: no rompe la FK, no se pierde y el cursor no avanza', async () => {
    const s = await setup();
    // Falta el miembro Beto: el pagador y las partes del gasto lo mencionan.
    const withoutBeto = groupRows(s).filter((r) => r.row.id !== BETO);

    const outcome = s.store.applyRemoteGroup(page(withoutBeto));

    expect(outcome.held).toBe(true);
    expect(s.store.cursors()).toEqual({});
    expect(rows(s, `SELECT COUNT(*) AS n FROM group_members`)).toEqual([{ n: 1 }]);
    // Las filas sin problema sí quedaron (el grupo, Ana).
    expect(rows(s, `SELECT COUNT(*) AS n FROM groups`)).toEqual([{ n: 1 }]);
    expect(rows(s, `PRAGMA foreign_key_check`)).toEqual([]);

    // Al llegar el padre, el reintento aplica lo que faltaba, sin duplicar lo ya guardado.
    const retry = s.store.applyRemoteGroup(page(groupRows(s)));
    expect(retry).toMatchObject({ held: false });
    expect(s.store.cursors()).toEqual({ [GROUP]: 7 });
    expect(rows(s, `SELECT COUNT(*) AS n FROM expenses`)).toEqual([{ n: 1 }]);
    expect(rows(s, `SELECT COUNT(*) AS n FROM expense_splits`)).toEqual([{ n: 2 }]);
    expect(rows(s, `SELECT COUNT(*) AS n FROM group_members`)).toEqual([{ n: 2 }]);
  });
});

describe('applyRemoteGroup: datos que llegan de la red', () => {
  it('una fila inválida se rechaza sin tocar SQLite ni romper el lote', async () => {
    const s = await setup();
    const bad = groupRows(s).map((r) =>
      r.table === 'transfers' ? serverRow('transfers', { ...r.row, amount: 'mucho' }) : r,
    );

    const outcome = s.store.applyRemoteGroup(page(bad));

    expect(outcome).toMatchObject({ applied: 4, held: true });
    expect(rows(s, `SELECT COUNT(*) AS n FROM transfers`)).toEqual([{ n: 0 }]);
    expect(rows(s, `SELECT COUNT(*) AS n FROM expenses`)).toEqual([{ n: 1 }]);
    expect(s.store.cursors()).toEqual({});
  });

  it.each([
    ['un monto negativo', { amount: -5 }],
    ['una moneda mal formada', { currency: 'usd' }],
    // Con el formato correcto pero fuera de ISO 4217: los saldos lanzarían UNKNOWN_CURRENCY.
    ['una moneda que no existe', { currency: 'QQQ' }],
    ['una moneda del grupo que no existe', { group_currency: 'QQQ' }],
    ['una fecha inexistente en el formato', { occurred_on: '09/10/2026' }],
    ['un id que no es uuid', { id: 'no-es-uuid' }],
    ['un título vacío', { title: '' }],
  ])('rechaza %s', async (_name, patch) => {
    const s = await setup();
    const bad = groupRows(s).map((r) =>
      r.table === 'expenses' ? serverRow('expenses', { ...r.row, ...patch }) : r,
    );

    const outcome = s.store.applyRemoteGroup(page(bad));

    expect(outcome.held).toBe(true);
    expect(rows(s, `SELECT COUNT(*) AS n FROM expenses`)).toEqual([{ n: 0 }]);
  });

  it('un grupo con una moneda que no existe no entra y queda retenido', async () => {
    const s = await setup();
    const bad = groupRows(s).map((r) =>
      r.table === 'groups' ? serverRow('groups', { ...r.row, currency: 'QQQ' }) : r,
    );

    const outcome = s.store.applyRemoteGroup(page(bad));

    expect(outcome.held).toBe(true);
    expect(rows(s, `SELECT COUNT(*) AS n FROM groups`)).toEqual([{ n: 0 }]);
    expect(s.store.cursors()).toEqual({});
  });

  it('una restricción de SQLite que falla a la mitad deja el cursor y se reintenta sin duplicar', async () => {
    const s = await setup();
    // amount 0 pasa el esquema pero viola expenses_amount_positive: falla dentro de SQLite.
    const outcome = s.store.applyRemoteGroup(page(groupRows(s, { amount: 0 })));

    expect(outcome.held).toBe(true);
    expect(s.store.cursors()).toEqual({});
    expect(rows(s, `SELECT COUNT(*) AS n FROM expenses`)).toEqual([{ n: 0 }]);
    const afterFailure = rows(s, `SELECT COUNT(*) AS n FROM group_members`);

    // Primer reintento con el mismo lote: falla igual y no duplica nada.
    s.store.applyRemoteGroup(page(groupRows(s, { amount: 0 })));
    expect(rows(s, `SELECT COUNT(*) AS n FROM group_members`)).toEqual(afterFailure);

    // El servidor corrige la fila: el reintento termina y el cursor avanza.
    const fixed = s.store.applyRemoteGroup(page(groupRows(s)));
    expect(fixed).toMatchObject({ held: false });
    expect(s.store.cursors()).toEqual({ [GROUP]: 7 });
    expect(rows(s, `SELECT COUNT(*) AS n FROM expenses`)).toEqual([{ n: 1 }]);
    expect(rows(s, `SELECT COUNT(*) AS n FROM group_members`)).toEqual([{ n: 2 }]);
  });
});

describe('applyRemoteGroup: el cursor avanza en la misma transacción', () => {
  it('si no se puede guardar el cursor, tampoco quedan las filas del grupo', async () => {
    const s = await setup();
    s.sqlite.run(
      `CREATE TRIGGER no_cursor BEFORE INSERT ON sync_cursors BEGIN SELECT RAISE(ABORT, 'sin cursor'); END`,
    );

    const outcome = s.store.applyRemoteGroup(page(groupRows(s)));

    expect(outcome).toEqual({ applied: 0, skipped: 0, held: true });
    for (const table of DOWNLOADED_TABLES) {
      expect(rows(s, `SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 0 }]);
    }
    expect(s.store.cursors()).toEqual({});
    expect(s.changes).toEqual([]);

    // Se reintenta: todo entra una vez y el cursor queda.
    s.sqlite.run(`DROP TRIGGER no_cursor`);
    expect(s.store.applyRemoteGroup(page(groupRows(s)))).toMatchObject({ applied: 5, held: false });
    expect(s.store.cursors()).toEqual({ [GROUP]: 7 });
    expect(rows(s, `SELECT COUNT(*) AS n FROM expenses`)).toEqual([{ n: 1 }]);
  });

  it('el cursor nunca retrocede', async () => {
    const s = await setup();
    s.store.applyRemoteGroup(page(groupRows(s), 9));
    s.store.applyRemoteGroup(page(groupRows(s), 4));

    expect(s.store.cursors()).toEqual({ [GROUP]: 9 });
    expect(cursorRows(s)).toHaveLength(1);
  });
});
