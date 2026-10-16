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
    for (const reason of ['conflict', 'currency_locked', 'group_currency_changed'] as const) {
      expect(
        pushResponseSchema.parse([{ id: ID, status: 'rejected', reason, current: [] }]),
      ).toEqual([{ id: ID, status: 'rejected', reason, current: [] }]);
    }
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

describe('contrato de red: respuesta de sync_pull', () => {
  it('convierte has_more en hasMore y conserva grupos, cursores y filas', () => {
    expect(
      pullResponseSchema.parse({
        groups: [{ id: ID, cursor: 12, rows: [group] }],
        has_more: true,
      }),
    ).toEqual({ groups: [{ id: ID, cursor: 12, rows: [group] }], hasMore: true });
  });

  it('acepta una respuesta sin grupos', () => {
    expect(pullResponseSchema.parse({ groups: [], has_more: false })).toEqual({
      groups: [],
      hasMore: false,
    });
  });

  it.each([
    ['un cursor negativo', { groups: [{ id: ID, cursor: -1, rows: [] }], has_more: false }],
    ['un cursor decimal', { groups: [{ id: ID, cursor: 1.5, rows: [] }], has_more: false }],
    [
      'un cursor mayor que el entero seguro',
      { groups: [{ id: ID, cursor: Number.MAX_SAFE_INTEGER + 2, rows: [] }], has_more: false },
    ],
    ['un grupo sin cursor', { groups: [{ id: ID, rows: [] }], has_more: false }],
    [
      'un id de grupo que no es UUID',
      { groups: [{ id: 'x', cursor: 1, rows: [] }], has_more: false },
    ],
    [
      'una tabla desconocida',
      { groups: [{ id: ID, cursor: 1, rows: [{ table: 'x', row: { id: ID } }] }], has_more: false },
    ],
    ['sin has_more', { groups: [] }],
    ['has_more como texto', { groups: [], has_more: 'false' }],
    ['sin groups', { has_more: false }],
    ['una lista en vez del objeto', []],
  ])('rechaza %s', (_name, body) => {
    expect(pullResponseSchema.safeParse(body).success).toBe(false);
  });
});

describe('listas del contrato', () => {
  it('coinciden con las que usa la base local y el servidor', () => {
    expect([...SYNC_ENTITIES]).toEqual(['group', 'member', 'category', 'expense', 'transfer']);
    expect([...SYNC_TABLES]).toEqual([
      'groups',
      'group_members',
      'categories',
      'expenses',
      'expense_payers',
      'expense_splits',
      'transfers',
    ]);
  });
});
