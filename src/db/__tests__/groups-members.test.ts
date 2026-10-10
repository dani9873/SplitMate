import { createTestGroup, createTestRepositories, type TestRepositories } from '../test-utils';

const code = (expected: string) => expect.objectContaining({ code: expected });

function addDinner(ctx: TestRepositories, groupId: string, ids: readonly string[], amount = 3000) {
  return ctx.repos.expenses.add({
    groupId,
    title: 'Cena',
    amount,
    currency: 'USD',
    payers: [{ memberId: ids[0] as string, amount }],
    split: { method: 'equal', participants: [...ids] },
    occurredOn: '2026-10-09',
  });
}

describe('perfil local', () => {
  it('no existe hasta que se crea y después siempre es el mismo', async () => {
    const ctx = await createTestRepositories();
    expect(ctx.repos.profile.get()).toBeNull();
    const ana = ctx.repos.profile.ensure('Ana');
    expect(ana.displayName).toBe('Ana');
    expect(ctx.repos.profile.ensure('Otro nombre').id).toBe(ana.id);
    expect(ctx.repos.profile.get()?.id).toBe(ana.id);
  });

  it('valida el nombre', async () => {
    const ctx = await createTestRepositories();
    expect(() => ctx.repos.profile.ensure('   ')).toThrow(code('VALIDATION'));
  });
});

describe('grupos', () => {
  it('se crean con emoji y color, o con los valores por defecto', async () => {
    const ctx = await createTestRepositories();
    const me = ctx.repos.profile.ensure('Ana');
    const plain = ctx.repos.groups.create({
      name: 'Casa',
      currency: 'COP',
      createdBy: me.id,
      members: [{ displayName: 'Ana', userId: me.id }],
    });
    expect(plain).toMatchObject({ emoji: null, color: 'teal', archivedAt: null });
    const trip = ctx.repos.groups.create({
      name: 'Playa',
      currency: 'USD',
      emoji: '🏖️',
      color: 'coral',
      createdBy: me.id,
      members: [{ displayName: 'Ana', userId: me.id }],
    });
    expect(trip).toMatchObject({ emoji: '🏖️', color: 'coral' });
    expect(() =>
      ctx.repos.groups.create({
        name: 'Mal',
        currency: 'USD',
        color: 'fucsia' as 'teal',
        createdBy: me.id,
        members: [{ displayName: 'Ana' }],
      }),
    ).toThrow(code('VALIDATION'));
  });

  it('actualiza nombre, emoji y color con bloqueo optimista', async () => {
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    const updated = ctx.repos.groups.update(group.id, 1, {
      name: 'Viaje a la costa',
      emoji: '🏝️',
      color: 'sky',
      currency: 'USD',
    });
    expect(updated).toMatchObject({
      name: 'Viaje a la costa',
      emoji: '🏝️',
      color: 'sky',
      version: 2,
    });
    expect(ctx.repos.groups.update(group.id, 2, { ...updated, emoji: null }).emoji).toBeNull();
    expect(() => ctx.repos.groups.update(group.id, 1, { ...updated })).toThrow(code('CONFLICT'));
  });

  it('cambia la moneda solo mientras no hay movimientos', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const base = { name: group.name, emoji: null, color: 'teal' as const };
    const inEur = ctx.repos.groups.update(group.id, 1, { ...base, currency: 'EUR' });
    expect(inEur.currency).toBe('EUR');
    expect(ctx.repos.groups.hasMovements(group.id)).toBe(false);
    ctx.repos.transfers.add({
      groupId: group.id,
      fromMemberId: ids[1] as string,
      toMemberId: ids[0] as string,
      amount: 100,
      currency: 'EUR',
      occurredOn: '2026-10-09',
    });
    expect(ctx.repos.groups.hasMovements(group.id)).toBe(true);
    expect(() => ctx.repos.groups.update(group.id, 2, { ...base, currency: 'USD' })).toThrow(
      code('CURRENCY_LOCKED'),
    );
    // Sin cambiar la moneda, el resto se puede editar.
    expect(
      ctx.repos.groups.update(group.id, 2, { ...base, name: 'Otro', currency: 'EUR' }).name,
    ).toBe('Otro');
  });

  it('archivar deja el grupo en solo lectura hasta restaurarlo', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const archived = ctx.repos.groups.archive(group.id, 1);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.version).toBe(2);

    expect(() => addDinner(ctx, group.id, ids)).toThrow(code('GROUP_ARCHIVED'));
    expect(() => ctx.repos.members.add(group.id, 'Dani')).toThrow(code('GROUP_ARCHIVED'));
    expect(() => ctx.repos.groups.update(group.id, 2, { ...archived, name: 'Otro' })).toThrow(
      code('GROUP_ARCHIVED'),
    );
    expect(() => ctx.repos.groups.archive(group.id, 2)).toThrow(code('GROUP_ARCHIVED'));

    const restored = ctx.repos.groups.unarchive(group.id, 2);
    expect(restored).toMatchObject({ archivedAt: null, version: 3 });
    expect(addDinner(ctx, group.id, ids).title).toBe('Cena');
  });

  it('resume cada grupo con sus miembros y tu saldo, archivados al final', async () => {
    const ctx = await createTestRepositories();
    const trip = createTestGroup(ctx);
    addDinner(ctx, trip.group.id, trip.ids, 3000);
    const house = createTestGroup(ctx, { names: ['Ana', 'Dani'] });
    ctx.repos.groups.archive(house.group.id, 1);
    const me = ctx.repos.profile.get();
    const foreign = ctx.repos.groups.create({
      name: 'Sin mí',
      currency: 'EUR',
      createdBy: me?.id as string,
      members: [{ displayName: 'Eva' }, { displayName: 'Fito' }],
    });

    const summaries = ctx.repos.groups.listSummaries();
    expect(summaries.map((s) => s.group.name)).toEqual(['Sin mí', 'Viaje', 'Viaje']);
    const [withoutMe, active, archived] = summaries;
    expect(withoutMe).toMatchObject({ memberCount: 2, me: null, myBalance: null });
    expect(withoutMe?.group.id).toBe(foreign.id);
    expect(active).toMatchObject({ memberCount: 3, myBalance: { amount: 2000, currency: 'USD' } });
    expect(active?.me?.displayName).toBe('Ana');
    expect(archived?.group.archivedAt).not.toBeNull();
    expect(archived?.myBalance).toEqual({ amount: 0, currency: 'USD' });
  });
});

describe('miembros', () => {
  it('agrega y renombra con bloqueo optimista', async () => {
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    const dani = ctx.repos.members.add(group.id, '  Dani ');
    expect(dani).toMatchObject({ displayName: 'Dani', role: 'member', userId: null });
    expect(ctx.repos.members.listByGroup(group.id).map((m) => m.displayName)).toEqual([
      'Ana',
      'Beto',
      'Carla',
      'Dani',
    ]);
    const renamed = ctx.repos.members.rename(dani.id, 1, 'Daniela');
    expect(renamed).toMatchObject({ displayName: 'Daniela', version: 2 });
    expect(() => ctx.repos.members.rename(dani.id, 1, 'Otra')).toThrow(code('CONFLICT'));
    expect(() => ctx.repos.members.rename(dani.id, 2, '')).toThrow(code('VALIDATION'));
    expect(() => ctx.repos.members.rename('nadie', 1, 'X')).toThrow(code('NOT_FOUND'));
  });

  it('quita solo a quien tiene saldo cero y lo conserva para el historial', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const [ana, beto, carla] = ids as [string, string, string];
    addDinner(ctx, group.id, [ana, beto]);

    let error: unknown;
    try {
      ctx.repos.members.remove(beto, 1);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: 'MEMBER_HAS_BALANCE',
      details: { balance: { amount: -1500, currency: 'USD' } },
    });

    ctx.repos.members.remove(carla, 1);
    expect(ctx.repos.members.listByGroup(group.id).map((m) => m.id)).toEqual([ana, beto]);
    const all = ctx.repos.members.listAll(group.id);
    expect(all.map((m) => [m.id, m.deletedAt === null])).toEqual([
      [ana, true],
      [beto, true],
      [carla, false],
    ]);
  });

  it('no quita al último miembro', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx, { names: ['Ana'] });
    expect(() => ctx.repos.members.remove(ids[0] as string, 1)).toThrow(code('LAST_MEMBER'));
    expect(ctx.repos.members.listByGroup(group.id)).toHaveLength(1);
  });

  it('no supera el máximo de miembros', async () => {
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    for (let index = 3; index < 50; index += 1) {
      ctx.repos.members.add(group.id, `Miembro ${index}`);
    }
    expect(() => ctx.repos.members.add(group.id, 'Uno más')).toThrow(code('VALIDATION'));
  });

  it('"soy yo" vincula el miembro al usuario local y lo mueve', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const [ana, beto] = ids as [string, string];
    const me = ctx.repos.profile.get();

    ctx.repos.members.setCurrentMember(group.id, beto);
    const after = ctx.repos.members.listByGroup(group.id);
    expect(after.find((m) => m.id === beto)?.userId).toBe(me?.id);
    expect(after.find((m) => m.id === ana)?.userId).toBeNull();

    ctx.repos.members.setCurrentMember(group.id, null);
    expect(ctx.repos.members.listByGroup(group.id).every((m) => m.userId === null)).toBe(true);
    expect(ctx.repos.groups.listSummaries()[0]?.me).toBeNull();
  });

  it('"soy yo" crea el usuario local con el nombre del miembro si aún no existe', async () => {
    const ctx = await createTestRepositories();
    const creator = ctx.repos.users.create({ displayName: 'Importado' });
    const group = ctx.repos.groups.create({
      name: 'Casa',
      currency: 'USD',
      createdBy: creator.id,
      members: [{ displayName: 'Lu' }, { displayName: 'Mar' }],
    });
    const [lu] = ctx.repos.members.listByGroup(group.id);
    ctx.repos.members.setCurrentMember(group.id, lu?.id as string);
    expect(ctx.repos.profile.get()?.displayName).toBe('Lu');
  });

  it('"soy yo" rechaza miembros de otro grupo', async () => {
    const ctx = await createTestRepositories();
    const first = createTestGroup(ctx);
    const second = createTestGroup(ctx);
    expect(() =>
      ctx.repos.members.setCurrentMember(first.group.id, second.ids[1] as string),
    ).toThrow(code('NOT_FOUND'));
  });
});
