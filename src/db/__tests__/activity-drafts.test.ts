import { z } from 'zod';

import type { DataChange } from '../changes';
import { createTestGroup, createTestRepositories } from '../test-utils';

const code = (expected: string) => expect.objectContaining({ code: expected });

describe('actividad', () => {
  it('une gastos, ingresos y transferencias del más reciente al más antiguo', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const [ana, beto, carla] = ids as [string, string, string];
    const hotel = ctx.repos.expenses.add({
      groupId: group.id,
      title: 'Hotel',
      amount: 9000,
      currency: 'USD',
      payers: [{ memberId: ana, amount: 9000 }],
      split: { method: 'equal', participants: ids },
      categoryId: '0199c82c-c000-7000-8000-000000000004',
      occurredOn: '2026-10-08',
    });
    const refund = ctx.repos.expenses.add({
      groupId: group.id,
      kind: 'income',
      title: 'Reembolso',
      amount: 1000,
      currency: 'EUR',
      exchangeRate: '1.1',
      payers: [{ memberId: beto, amount: 1000 }],
      split: { method: 'equal', participants: [ana, beto] },
      occurredOn: '2026-10-09',
    });
    const payment = ctx.repos.transfers.add({
      groupId: group.id,
      fromMemberId: carla,
      toMemberId: ana,
      amount: 3000,
      currency: 'USD',
      occurredOn: '2026-10-09',
    });
    ctx.repos.members.rename(beto, 1, 'Roberto');

    const items = ctx.repos.activity.list({ groupId: group.id });
    expect(items.map((item) => [item.kind, item.id])).toEqual([
      ['transfer', payment.id],
      ['income', refund.id],
      ['expense', hotel.id],
    ]);
    const [transfer, income, expense] = items;
    expect(transfer).toMatchObject({
      kind: 'transfer',
      groupName: 'Viaje',
      amount: { amount: 3000, currency: 'USD' },
      from: { memberId: carla, name: 'Carla', removed: false },
      to: { memberId: ana, name: 'Ana' },
    });
    expect(income).toMatchObject({
      kind: 'income',
      title: 'Reembolso',
      amount: { amount: 1000, currency: 'EUR' },
      groupAmount: { amount: 1100, currency: 'USD' },
      payers: [{ memberId: beto, name: 'Roberto', amount: { amount: 1100, currency: 'USD' } }],
    });
    expect(expense).toMatchObject({
      categoryId: '0199c82c-c000-7000-8000-000000000004',
      splits: [
        { memberId: ana, amount: { amount: 3000, currency: 'USD' } },
        { memberId: beto, amount: { amount: 3000, currency: 'USD' } },
        { memberId: carla, amount: { amount: 3000, currency: 'USD' } },
      ],
    });
  });

  it('sin grupo lista todos los grupos, cada fila con su propia moneda', async () => {
    const ctx = await createTestRepositories();
    const usd = createTestGroup(ctx);
    const cop = createTestGroup(ctx, { currency: 'COP' });
    for (const [{ group, ids }, amount] of [
      [usd, 1500],
      [cop, 50_000],
    ] as const) {
      ctx.repos.expenses.add({
        groupId: group.id,
        title: 'Almuerzo',
        amount,
        currency: group.currency,
        payers: [{ memberId: ids[0] as string, amount }],
        split: { method: 'equal', participants: ids },
        occurredOn: '2026-10-09',
      });
    }
    ctx.repos.groups.archive(cop.group.id, 1);
    const items = ctx.repos.activity.list();
    expect(items.map((item) => [item.groupId, item.groupCurrency, item.groupAmount])).toEqual([
      [cop.group.id, 'COP', { amount: 50_000, currency: 'COP' }],
      [usd.group.id, 'USD', { amount: 1500, currency: 'USD' }],
    ]);
  });

  it('nombra a los miembros quitados y lo indica', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const [ana, , carla] = ids as [string, string, string];
    ctx.repos.transfers.add({
      groupId: group.id,
      fromMemberId: carla,
      toMemberId: ana,
      amount: 100,
      currency: 'USD',
      occurredOn: '2026-10-09',
    });
    ctx.repos.transfers.add({
      groupId: group.id,
      fromMemberId: ana,
      toMemberId: carla,
      amount: 100,
      currency: 'USD',
      occurredOn: '2026-10-09',
    });
    ctx.repos.members.remove(carla, 1);
    const [latest] = ctx.repos.activity.list({ groupId: group.id });
    expect(latest).toMatchObject({ to: { name: 'Carla', removed: true } });
  });

  it('lista las categorías predefinidas en orden fijo', async () => {
    const ctx = await createTestRepositories();
    expect(ctx.repos.categories.list().map((c) => [c.key, c.icon])).toEqual([
      ['food', 'utensils'],
      ['groceries', 'shopping-cart'],
      ['transport', 'car'],
      ['lodging', 'bed'],
      ['entertainment', 'party-popper'],
      ['shopping', 'shopping-bag'],
      ['utilities', 'plug'],
      ['health', 'heart-pulse'],
      ['other', 'tag'],
    ]);
  });
});

describe('borradores', () => {
  const draftSchema = z.object({ v: z.literal(1), title: z.string(), expression: z.string() });

  it('guarda uno por grupo y lo valida al leerlo', async () => {
    const ctx = await createTestRepositories();
    const first = createTestGroup(ctx);
    const second = createTestGroup(ctx);
    ctx.repos.drafts.save(first.group.id, { v: 1, title: 'Cena', expression: '12+8' });
    expect(ctx.repos.drafts.get(first.group.id, draftSchema)).toEqual({
      v: 1,
      title: 'Cena',
      expression: '12+8',
    });
    expect(ctx.repos.drafts.get(second.group.id, draftSchema)).toBeNull();

    ctx.repos.drafts.save(first.group.id, { v: 1, title: 'Cena y postre', expression: '20' });
    expect(ctx.repos.drafts.get(first.group.id, draftSchema)?.title).toBe('Cena y postre');

    ctx.repos.drafts.discard(first.group.id);
    expect(ctx.repos.drafts.get(first.group.id, draftSchema)).toBeNull();
  });

  it('descarta un borrador que ya no cumple el esquema', async () => {
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    ctx.repos.drafts.save(group.id, { v: 0, title: 'Viejo' });
    expect(ctx.repos.drafts.get(group.id, draftSchema)).toBeNull();
    // Se borró: aunque el esquema cambie otra vez, ya no aparece.
    expect(ctx.repos.drafts.get(group.id, z.unknown())).toBeNull();
  });

  it('rechaza borradores enormes y no avisa cambios de datos', async () => {
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    const listener = jest.fn();
    ctx.bus.subscribe(listener);
    expect(() => ctx.repos.drafts.save(group.id, { notes: 'x'.repeat(20_000) })).toThrow(
      code('VALIDATION'),
    );
    ctx.repos.drafts.save(group.id, { v: 1, title: 'Cena', expression: '1' });
    ctx.repos.drafts.discard(group.id);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('avisos de cambios de los repositorios', () => {
  it('cada escritura avisa una vez con sus tablas y su grupo, después de guardar', async () => {
    const ctx = await createTestRepositories();
    const changes: DataChange[] = [];
    ctx.bus.subscribe((change) => changes.push(change));
    const { group, ids } = createTestGroup(ctx);
    const summary = (change: DataChange | undefined) => ({
      tables: [...(change?.tables ?? [])].sort(),
      groups: change?.groupIds ? [...change.groupIds] : null,
      source: change?.source,
    });

    expect(changes.map(summary)).toEqual([
      { tables: ['users'], groups: null, source: 'local' },
      { tables: ['group_members', 'groups'], groups: [group.id], source: 'local' },
    ]);

    changes.length = 0;
    const expense = ctx.repos.expenses.add({
      groupId: group.id,
      title: 'Cena',
      amount: 300,
      currency: 'USD',
      payers: [{ memberId: ids[0] as string, amount: 300 }],
      split: { method: 'equal', participants: ids },
      occurredOn: '2026-10-09',
    });
    ctx.repos.expenses.remove(expense.id, 1);
    expect(changes.map(summary)).toEqual([
      {
        tables: ['expense_payers', 'expense_splits', 'expenses'],
        groups: [group.id],
        source: 'local',
      },
      {
        tables: ['expense_payers', 'expense_splits', 'expenses'],
        groups: [group.id],
        source: 'local',
      },
    ]);
  });

  it('una escritura que falla no avisa nada', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const listener = jest.fn();
    ctx.bus.subscribe(listener);
    expect(() =>
      ctx.repos.expenses.add({
        groupId: group.id,
        title: 'Cena',
        amount: 300,
        currency: 'USD',
        payers: [{ memberId: ids[0] as string, amount: 299 }],
        split: { method: 'equal', participants: ids },
        occurredOn: '2026-10-09',
      }),
    ).toThrow();
    expect(() => ctx.repos.members.rename('nadie', 1, 'X')).toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('las escrituras dentro de un lote avisan una sola vez', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const listener = jest.fn();
    ctx.bus.subscribe(listener);
    ctx.repos.changes.batch(() => {
      ctx.repos.members.add(group.id, 'Dani');
      ctx.repos.transfers.add({
        groupId: group.id,
        fromMemberId: ids[1] as string,
        toMemberId: ids[0] as string,
        amount: 100,
        currency: 'USD',
        occurredOn: '2026-10-09',
      });
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...(listener.mock.calls[0]?.[0] as DataChange).tables].sort()).toEqual([
      'group_members',
      'transfers',
    ]);
  });
});
