import { pullResponseSchema, pushResponseSchema, SYNC_ENTITIES, SYNC_TABLES } from '../wire';

const ID = '01990000-0000-7000-8000-000000000001';
const OTHER_ID = '01990000-0000-7000-8000-000000000002';
const group = { table: 'groups', row: { id: ID, name: 'Viaje', version: 1, change_seq: 3 } };

describe('contrato de red: respuesta de sync_push', () => {
  it('acepta un envío aplicado, con la unidad actual del servidor', () => {
    const parsed = pushResponseSchema.parse([
      { id: ID, status: 'applied', version: 2, current: [group] },
    ]);
    expect(parsed).toEqual([{ id: ID, status: 'applied', version: 2, current: [group] }]);
  });

  it('acepta un rechazo con cada razón y su unidad actual (que puede venir vacía)', () => {
    for (const reason of [
      'conflict',
      'currency_locked',
      'group_currency_changed',
      'member_linked',
    ] as const) {
      expect(
        pushResponseSchema.parse([{ id: ID, status: 'rejected', reason, current: [] }]),
      ).toEqual([{ id: ID, status: 'rejected', reason, current: [] }]);
    }
  });

  it('acepta un rechazo por cupo con el cupo que se alcanzó', () => {
    for (const quota of ['groups', 'members', 'categories', 'movements'] as const) {
      expect(
        pushResponseSchema.parse([
          { id: ID, status: 'rejected', reason: 'quota', quota, current: [] },
        ]),
      ).toEqual([{ id: ID, status: 'rejected', reason: 'quota', quota, current: [] }]);
    }
  });

  it('rechaza un cupo desconocido', () => {
    expect(
      pushResponseSchema.safeParse([
        { id: ID, status: 'rejected', reason: 'quota', quota: 'gastos', current: [] },
      ]).success,
    ).toBe(false);
  });

  it('acepta un envío fallido, con o sin el campo que falló', () => {
    expect(
      pushResponseSchema.parse([
        { id: ID, status: 'failed', reason: 'invalid', field: 'payers.amount' },
        { id: OTHER_ID, status: 'failed', reason: 'forbidden' },
      ]),
    ).toEqual([
      { id: ID, status: 'failed', reason: 'invalid', field: 'payers.amount' },
      { id: OTHER_ID, status: 'failed', reason: 'forbidden' },
    ]);
  });

  it('acepta una lista vacía', () => {
    expect(pushResponseSchema.parse([])).toEqual([]);
  });

  it.each([
    ['un estado desconocido', [{ id: ID, status: 'maybe', version: 1, current: [] }]],
    ['una versión decimal', [{ id: ID, status: 'applied', version: 1.5, current: [] }]],
    ['una versión cero', [{ id: ID, status: 'applied', version: 0, current: [] }]],
    ['una versión como texto', [{ id: ID, status: 'applied', version: '2', current: [] }]],
    ['un applied sin current', [{ id: ID, status: 'applied', version: 1 }]],
    ['un id que no es UUID', [{ id: 'abc', status: 'applied', version: 1, current: [] }]],
    [
      'una razón de rechazo desconocida',
      [{ id: ID, status: 'rejected', reason: 'x', current: [] }],
    ],
    ['un rechazo sin current', [{ id: ID, status: 'rejected', reason: 'conflict' }]],
    ['una razón de falla desconocida', [{ id: ID, status: 'failed', reason: 'x' }]],
    ['un campo que no es texto', [{ id: ID, status: 'failed', reason: 'invalid', field: 3 }]],
    [
      'una tabla desconocida',
      [{ id: ID, status: 'applied', version: 1, current: [{ table: 'users', row: { id: ID } }] }],
    ],
    [
      'una fila sin id',
      [
        {
          id: ID,
          status: 'applied',
          version: 1,
          current: [{ table: 'groups', row: { name: 'x' } }],
        },
      ],
    ],
    [
      'una fila que no es objeto',
      [{ id: ID, status: 'applied', version: 1, current: [{ table: 'groups', row: 'x' }] }],
    ],
    ['algo que no es una lista', { status: 'applied' }],
    ['null', null],
  ])('rechaza %s', (_name, body) => {
    expect(pushResponseSchema.safeParse(body).success).toBe(false);
  });
});

describe('contrato de red: respuesta de sync_pull_v2', () => {
  const entire = (over: Record<string, unknown> = {}) => ({
    id: ID,
    cursor: 12,
    partial: false,
    next: null,
    rows: [group],
    ...over,
  });
  const next = { seq: 0, hw: 40, after: { t: 3, id: OTHER_ID } };

  it('convierte has_more en hasMore y conserva grupos, cursores, filas y lost', () => {
    expect(
      pullResponseSchema.parse({ groups: [entire()], has_more: true, lost: [OTHER_ID] }),
    ).toEqual({ groups: [entire()], hasMore: true, lost: [OTHER_ID] });
  });

  it('acepta una respuesta sin grupos', () => {
    expect(pullResponseSchema.parse({ groups: [], has_more: false, lost: [] })).toEqual({
      groups: [],
      hasMore: false,
      lost: [],
    });
  });

  it('acepta una página parcial con su cursor siguiente y sin cursor', () => {
    const partial = entire({ cursor: null, partial: true, next });
    expect(pullResponseSchema.parse({ groups: [partial], has_more: true, lost: [] })).toEqual({
      groups: [partial],
      hasMore: true,
      lost: [],
    });
  });

  it.each([
    ['un cursor negativo', entire({ cursor: -1 })],
    ['un cursor decimal', entire({ cursor: 1.5 })],
    ['un cursor mayor que el entero seguro', entire({ cursor: Number.MAX_SAFE_INTEGER + 2 })],
    ['un grupo sin cursor', { id: ID, partial: false, next: null, rows: [] }],
    ['un grupo sin partial', { id: ID, cursor: 1, next: null, rows: [] }],
    ['un id de grupo que no es UUID', entire({ id: 'x' })],
    ['una tabla desconocida', entire({ rows: [{ table: 'x', row: { id: ID } }] })],
    ['una parcial con cursor', entire({ partial: true, next })],
    ['una parcial sin next', entire({ cursor: null, partial: true })],
    ['una entera con next', entire({ next })],
    ['una entera sin cursor', entire({ cursor: null })],
    [
      'un next con seq mayor que hw',
      entire({ cursor: null, partial: true, next: { ...next, seq: 41 } }),
    ],
    [
      'un next con t fuera de 1 a 8',
      entire({ cursor: null, partial: true, next: { ...next, after: { t: 9, id: ID } } }),
    ],
    [
      'un next con id que no es UUID',
      entire({ cursor: null, partial: true, next: { ...next, after: { t: 1, id: 'x' } } }),
    ],
  ])('rechaza %s', (_name, groupBody) => {
    expect(
      pullResponseSchema.safeParse({ groups: [groupBody], has_more: false, lost: [] }).success,
    ).toBe(false);
  });

  it.each([
    ['sin has_more', { groups: [], lost: [] }],
    ['has_more como texto', { groups: [], has_more: 'false', lost: [] }],
    ['sin groups', { has_more: false, lost: [] }],
    ['sin lost', { groups: [], has_more: false }],
    ['lost con algo que no es UUID', { groups: [], has_more: false, lost: ['x'] }],
    ['una lista en vez del objeto', []],
    [
      'más de 2000 filas en un grupo',
      {
        groups: [entire({ rows: Array.from({ length: 2001 }, () => group) })],
        has_more: false,
        lost: [],
      },
    ],
    [
      'más de 1000 grupos perdidos',
      { groups: [], has_more: false, lost: Array.from({ length: 1001 }, () => OTHER_ID) },
    ],
  ])('rechaza la respuesta %s', (_name, body) => {
    expect(pullResponseSchema.safeParse(body).success).toBe(false);
  });
});

describe('listas del contrato', () => {
  it('coinciden con las que usa la base local y el servidor', () => {
    expect([...SYNC_ENTITIES]).toEqual(['group', 'member', 'category', 'expense', 'transfer']);
    expect([...SYNC_TABLES]).toEqual([
      'groups',
      'group_access',
      'group_members',
      'categories',
      'expenses',
      'expense_payers',
      'expense_splits',
      'transfers',
    ]);
  });
});
