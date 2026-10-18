import { recordConflict, type NewConflict } from '@/db/sync/conflicts';
import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';

import { applyMine, deleteNow, readConflictItem, reasonKey } from '../conflict-review';

const DRAFT = '01990000-0000-7000-8000-0000000000c1';

let ctx: TestRepositories;
let setup: ReturnType<typeof createTestGroup>;

beforeEach(async () => {
  ctx = await createTestRepositories();
  setup = createTestGroup(ctx);
});

function draft(overrides: Partial<NewConflict>) {
  const value: NewConflict = {
    id: DRAFT,
    entity: 'group',
    entityId: setup.group.id,
    groupId: setup.group.id,
    reason: 'conflict',
    data: {},
    serverDeleted: false,
    wasNew: false,
    wasDeletion: false,
    createdAt: 1,
    ...overrides,
  };
  recordConflict(ctx.db, value);
  return ctx.repos.conflicts.get(DRAFT) as NonNullable<ReturnType<typeof ctx.repos.conflicts.get>>;
}

const dinner = () =>
  ctx.repos.expenses.add({
    groupId: setup.group.id,
    title: 'Cena',
    amount: 3000,
    currency: 'USD',
    payers: [{ memberId: setup.ids[0] as string, amount: 3000 }],
    split: { method: 'equal', participants: [setup.ids[0] as string, setup.ids[1] as string] },
    occurredOn: '2026-10-08',
  });

describe('movimientos', () => {
  it('con el gasto activo se revisa como edición, con el título del usuario', () => {
    const expense = dinner();
    const item = readConflictItem(
      ctx.repos,
      draft({ entity: 'expense', entityId: expense.id, data: { title: 'Cena mía' } }),
    );

    expect(item).toMatchObject({
      kind: 'movement',
      label: 'Cena mía',
      route: `/groups/${setup.group.id}/entries/${expense.id}/edit?fromConflict=${DRAFT}`,
    });
  });

  it('con el gasto borrado o inexistente se revisa como alta', () => {
    const expense = dinner();
    ctx.repos.expenses.remove(expense.id, expense.version);
    const item = readConflictItem(
      ctx.repos,
      draft({ entity: 'expense', entityId: expense.id, data: { title: 'Cena mía' } }),
    );

    expect(item.route).toBe(`/groups/${setup.group.id}/entries/new?fromConflict=${DRAFT}`);
  });

  it('una transferencia se nombra con quién paga a quién y se revisa igual', () => {
    const transfer = ctx.repos.transfers.add({
      groupId: setup.group.id,
      fromMemberId: setup.ids[1] as string,
      toMemberId: setup.ids[0] as string,
      amount: 500,
      currency: 'USD',
      occurredOn: '2026-10-08',
    });
    const item = readConflictItem(
      ctx.repos,
      draft({
        entity: 'transfer',
        entityId: transfer.id,
        data: { from_member_id: setup.ids[1], to_member_id: setup.ids[2] },
      }),
    );

    expect(item).toMatchObject({ kind: 'movement', label: 'Beto → Carla' });
    expect(item.route).toBe(
      `/groups/${setup.group.id}/entries/${transfer.id}/edit?fromConflict=${DRAFT}`,
    );
  });
});

describe('borrados que no se aplicaron', () => {
  it('"Borrar ahora" borra sobre la versión actual y descarta el borrador', () => {
    const expense = dinner();
    // Alguien lo editó: la versión actual ya no es la que tenía el usuario.
    ctx.repos.expenses.update(expense.id, expense.version, {
      groupId: setup.group.id,
      title: 'Cena editada',
      amount: 3000,
      currency: 'USD',
      payers: [{ memberId: setup.ids[0] as string, amount: 3000 }],
      split: { method: 'equal', participants: [setup.ids[0] as string] },
      occurredOn: '2026-10-08',
    });
    const item = readConflictItem(
      ctx.repos,
      draft({
        entity: 'expense',
        entityId: expense.id,
        wasDeletion: true,
        data: { title: 'Cena', deleted: true },
      }),
    );

    expect(item).toMatchObject({ kind: 'deletion', canDeleteNow: true });
    deleteNow(ctx.repos, item);

    expect(ctx.repos.expenses.get(expense.id)).toBeUndefined();
    expect(ctx.repos.conflicts.get(DRAFT)).toBeUndefined();
  });

  it('si ya no existe, no ofrece borrar y el borrador sigue hasta que el usuario decida', () => {
    const expense = dinner();
    ctx.repos.expenses.remove(expense.id, expense.version);
    const item = readConflictItem(
      ctx.repos,
      draft({
        entity: 'expense',
        entityId: expense.id,
        wasDeletion: true,
        data: { title: 'Cena' },
      }),
    );

    expect(item).toMatchObject({ kind: 'deletion', canDeleteNow: false });
    expect(ctx.repos.conflicts.get(DRAFT)).toBeDefined();
  });

  it('un borrado que falla deja el borrador', () => {
    const [ana, beto] = setup.ids as [string, string];
    // Beto debe dinero: no se puede quitar.
    ctx.repos.expenses.add({
      groupId: setup.group.id,
      title: 'Taxi',
      amount: 1000,
      currency: 'USD',
      payers: [{ memberId: ana, amount: 1000 }],
      split: { method: 'equal', participants: [ana, beto] },
      occurredOn: '2026-10-08',
    });
    const item = readConflictItem(
      ctx.repos,
      draft({
        entity: 'member',
        entityId: beto,
        wasDeletion: true,
        data: { display_name: 'Beto' },
      }),
    );

    expect(() => deleteNow(ctx.repos, item)).toThrow();
    expect(ctx.repos.conflicts.get(DRAFT)).toBeDefined();
  });
});

describe('grupo y miembro', () => {
  const groupData = (overrides: Record<string, unknown> = {}) => ({
    id: setup.group.id,
    name: 'Playa',
    currency: setup.group.currency,
    emoji: setup.group.emoji,
    color: setup.group.color,
    archived: false,
    deleted: false,
    ...overrides,
  });

  it('muestra solo los campos que difieren, con tu valor y el actual', () => {
    const item = readConflictItem(ctx.repos, draft({ data: groupData() }));

    expect(item.kind).toBe('fields');
    expect(item.diffs).toEqual([{ field: 'name', mine: 'Playa', current: 'Viaje' }]);
    expect(item.canUseMine).toBe(true);
  });

  it('"Usar la mía" aplica el valor sobre la versión actual y descarta el borrador', () => {
    // El servidor ya cambió el grupo a la versión siguiente.
    const renamed = ctx.repos.groups.rename(setup.group.id, setup.group.version, 'Otro');
    const item = readConflictItem(ctx.repos, draft({ data: groupData() }));

    applyMine(ctx.repos, item);

    const group = ctx.repos.groups.get(setup.group.id);
    expect(group?.name).toBe('Playa');
    expect(group?.version).toBe(renamed.version + 1);
    expect(ctx.repos.conflicts.get(DRAFT)).toBeUndefined();
  });

  it('si la moneda del grupo es lo que difiere, solo se puede dar por entendido', () => {
    const item = readConflictItem(
      ctx.repos,
      draft({ reason: 'currency_locked', data: groupData({ currency: 'EUR' }) }),
    );

    expect(item.diffs.map((d) => d.field)).toContain('currency');
    expect(item.canUseMine).toBe(false);
  });

  it('un grupo archivado no se puede editar con "Usar la mía"', () => {
    ctx.repos.groups.archive(setup.group.id, setup.group.version);
    // Solo difiere el nombre: lo único que impide aplicarlo es que el grupo está archivado.
    const item = readConflictItem(ctx.repos, draft({ data: groupData({ archived: true }) }));

    expect(item.diffs.map((d) => d.field)).toEqual(['name']);
    expect(item.canUseMine).toBe(false);
  });

  it('un miembro: "Usar la mía" lo renombra', () => {
    const beto = setup.members[1];
    const item = readConflictItem(
      ctx.repos,
      draft({
        entity: 'member',
        entityId: beto?.id as string,
        data: { id: beto?.id, display_name: 'Roberto', user_id: null, role: 'member' },
      }),
    );

    expect(item.diffs).toEqual([{ field: 'name', mine: 'Roberto', current: 'Beto' }]);
    applyMine(ctx.repos, item);
    expect(
      ctx.repos.members.listAll(setup.group.id).find((m) => m.id === beto?.id)?.displayName,
    ).toBe('Roberto');
    expect(ctx.repos.conflicts.get(DRAFT)).toBeUndefined();
  });

  it('una categoría solo se muestra: no hay nada que aplicar', () => {
    const item = readConflictItem(
      ctx.repos,
      draft({ entity: 'category', entityId: DRAFT, data: { name: 'Comida' } }),
    );

    expect(item).toMatchObject({ kind: 'fields', label: 'Comida', canUseMine: false, diffs: [] });
  });
});

describe('motivos de la 4b', () => {
  it('member_linked: un borrado que no se puede repetir mientras la cuenta tenga acceso', () => {
    const beto = setup.ids[1] as string;
    const d = draft({
      entity: 'member',
      entityId: beto,
      reason: 'member_linked',
      wasDeletion: true,
      data: { id: beto, display_name: 'Beto', deleted: true },
    });
    const item = readConflictItem(ctx.repos, d);
    expect(item.kind).toBe('deletion');
    // El miembro sigue ahí, pero "Borrar ahora" no se ofrece: primero se le quita el acceso.
    expect(item.canDeleteNow).toBe(false);
    expect(reasonKey(d)).toBe('memberLinked');
  });

  it.each([
    ['groups', 'quotaGroups'],
    ['members', 'quotaMembers'],
    ['categories', 'quotaCategories'],
    ['movements', 'quotaMovements'],
  ] as const)('quota %s se explica con su propio texto', (quota, key) => {
    const d = draft({
      entity: 'member',
      entityId: '01990000-0000-7000-8000-0000000000d9',
      reason: 'quota',
      quota,
      wasNew: true,
      data: { display_name: 'Dani' },
    });
    expect(d.quota).toBe(quota);
    expect(reasonKey(d)).toBe(key);
  });

  it('quota de un miembro nuevo: nada que aplicar sobre la versión actual', () => {
    const d = draft({
      entity: 'member',
      entityId: '01990000-0000-7000-8000-0000000000d9',
      reason: 'quota',
      quota: 'members',
      wasNew: true,
      data: { display_name: 'Dani' },
    });
    const item = readConflictItem(ctx.repos, d);
    expect(item.kind).toBe('fields');
    expect(item.canUseMine).toBe(false);
    expect(item.diffs).toEqual([]);
    expect(item.label).toBe('Dani');
  });
});
