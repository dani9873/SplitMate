import type { AddExpenseInput } from '../repositories';
import { createTestGroup, createTestRepositories } from '../test-utils';

const code = (expected: string) => expect.objectContaining({ code: expected });

function dinner(groupId: string, ids: readonly string[], overrides: Partial<AddExpenseInput> = {}) {
  return {
    groupId,
    title: 'Cena',
    amount: 3000,
    currency: 'USD',
    payers: [{ memberId: ids[0] as string, amount: 3000 }],
    split: { method: 'equal' as const, participants: [...ids] },
    occurredOn: '2026-10-09',
    ...overrides,
  };
}

const balanceOf = (
  balances: readonly { memberId: string; amount: { amount: number } }[],
  memberId: string,
) => balances.find((b) => b.memberId === memberId)?.amount.amount;

describe('gastos: leer, editar, borrar y restaurar', () => {
  it('lee un gasto con sus partes y no devuelve los borrados', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const expense = ctx.repos.expenses.add(dinner(group.id, ids));
    expect(ctx.repos.expenses.get(expense.id)).toMatchObject({
      id: expense.id,
      payers: [expect.objectContaining({ amount: 3000 })],
      splits: [
        expect.objectContaining({ amount: 1000 }),
        expect.objectContaining({ amount: 1000 }),
        expect.objectContaining({ amount: 1000 }),
      ],
    });
    ctx.repos.expenses.remove(expense.id, 1);
    expect(ctx.repos.expenses.get(expense.id)).toBeUndefined();
    expect(ctx.repos.expenses.get('no-existe')).toBeUndefined();
  });

  it('edita monto, pagadores y división, y los saldos se recalculan', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const [ana, beto, carla] = ids as [string, string, string];
    const expense = ctx.repos.expenses.add(dinner(group.id, ids));

    const edited = ctx.repos.expenses.update(
      expense.id,
      1,
      dinner(group.id, ids, {
        title: 'Cena y postre',
        amount: 4000,
        payers: [{ memberId: beto, amount: 4000 }],
        split: {
          method: 'shares',
          shares: [
            { memberId: ana, shares: 1 },
            { memberId: beto, shares: 3 },
          ],
        },
        categoryId: '0199c82c-c000-7000-8000-000000000001',
      }),
    );

    expect(edited).toMatchObject({
      id: expense.id,
      title: 'Cena y postre',
      amount: 4000,
      splitMethod: 'shares',
      version: 2,
    });
    expect(edited.splits.map((s) => [s.memberId, s.amount, s.inputValue])).toEqual([
      [ana, 1000, 1],
      [beto, 3000, 3],
    ]);
    const { balances } = ctx.repos.balances.forGroup(group.id);
    expect(balanceOf(balances, ana)).toBe(-1000);
    expect(balanceOf(balances, beto)).toBe(1000);
    expect(balanceOf(balances, carla)).toBe(0);
    expect(() => ctx.repos.expenses.update(expense.id, 1, dinner(group.id, ids))).toThrow(
      code('CONFLICT'),
    );
  });

  it('una edición conserva a un miembro quitado que ya estaba en el gasto', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const [ana, beto, carla] = ids as [string, string, string];
    // Carla participa en un gasto que se compensa, así su saldo queda en cero.
    const expense = ctx.repos.expenses.add(
      dinner(group.id, ids, {
        payers: [
          { memberId: ana, amount: 2000 },
          { memberId: carla, amount: 1000 },
        ],
      }),
    );
    ctx.repos.members.remove(carla, 1);

    const edited = ctx.repos.expenses.update(
      expense.id,
      1,
      dinner(group.id, ids, {
        amount: 6000,
        payers: [
          { memberId: ana, amount: 5000 },
          { memberId: carla, amount: 1000 },
        ],
      }),
    );
    expect(edited.splits.map((s) => s.memberId)).toEqual([ana, beto, carla]);
    const { balances } = ctx.repos.balances.forGroup(group.id);
    expect(balanceOf(balances, carla)).toBe(-1000);

    // Pero no se puede sumar a un miembro quitado que no estaba.
    const other = ctx.repos.expenses.add(dinner(group.id, [ana, beto]));
    expect(() =>
      ctx.repos.expenses.update(other.id, 1, dinner(group.id, [ana, beto, carla])),
    ).toThrow(code('VALIDATION'));
  });

  it('restaurar devuelve el gasto y solo las partes de ese borrado', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const expense = ctx.repos.expenses.add(dinner(group.id, ids));
    // La edición borra las partes originales; restaurar no debe revivirlas.
    ctx.repos.expenses.update(
      expense.id,
      1,
      dinner(group.id, ids, {
        amount: 6000,
        payers: [{ memberId: ids[0] as string, amount: 6000 }],
      }),
    );
    ctx.repos.expenses.remove(expense.id, 2);
    expect(ctx.repos.expenses.listByGroup(group.id)).toEqual([]);

    expect(() => ctx.repos.expenses.restore(expense.id, 2)).toThrow(code('CONFLICT'));
    ctx.repos.expenses.restore(expense.id, 3);
    const restored = ctx.repos.expenses.get(expense.id);
    expect(restored).toMatchObject({ amount: 6000, version: 4, deletedAt: null });
    expect(restored?.splits.map((s) => s.amount)).toEqual([2000, 2000, 2000]);
    expect(restored?.payers.map((p) => p.amount)).toEqual([6000]);
    expect(() => ctx.repos.expenses.restore(expense.id, 4)).toThrow(code('NOT_FOUND'));
  });

  it('en un grupo archivado no se agrega, edita, borra ni restaura', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const kept = ctx.repos.expenses.add(dinner(group.id, ids));
    const removed = ctx.repos.expenses.add(dinner(group.id, ids));
    ctx.repos.expenses.remove(removed.id, 1);
    ctx.repos.groups.archive(group.id, 1);
    expect(() => ctx.repos.expenses.add(dinner(group.id, ids))).toThrow(code('GROUP_ARCHIVED'));
    expect(() => ctx.repos.expenses.update(kept.id, 1, dinner(group.id, ids))).toThrow(
      code('GROUP_ARCHIVED'),
    );
    expect(() => ctx.repos.expenses.remove(kept.id, 1)).toThrow(code('GROUP_ARCHIVED'));
    expect(() => ctx.repos.expenses.restore(removed.id, 2)).toThrow(code('GROUP_ARCHIVED'));
  });

  it('no permite mover un gasto a otro grupo al editarlo', async () => {
    const ctx = await createTestRepositories();
    const first = createTestGroup(ctx);
    const second = createTestGroup(ctx);
    const expense = ctx.repos.expenses.add(dinner(first.group.id, first.ids));
    expect(() =>
      ctx.repos.expenses.update(expense.id, 1, dinner(second.group.id, second.ids)),
    ).toThrow(code('VALIDATION'));
  });
});

describe('transferencias: leer, editar, borrar y restaurar', () => {
  it('cubre el ciclo completo con bloqueo optimista', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const [ana, beto, carla] = ids as [string, string, string];
    const base = { groupId: group.id, currency: 'USD', occurredOn: '2026-10-09' };
    const transfer = ctx.repos.transfers.add({
      ...base,
      fromMemberId: beto,
      toMemberId: ana,
      amount: 500,
    });
    expect(ctx.repos.transfers.get(transfer.id)).toMatchObject({ amount: 500, version: 1 });

    const edited = ctx.repos.transfers.update(transfer.id, 1, {
      ...base,
      fromMemberId: carla,
      toMemberId: ana,
      amount: 700,
      occurredOn: '2026-10-08',
    });
    expect(edited).toMatchObject({
      fromMemberId: carla,
      amount: 700,
      version: 2,
      occurredOn: '2026-10-08',
    });
    expect(() =>
      ctx.repos.transfers.update(transfer.id, 1, {
        ...base,
        fromMemberId: carla,
        toMemberId: ana,
        amount: 1,
      }),
    ).toThrow(code('CONFLICT'));

    ctx.repos.transfers.remove(transfer.id, 2);
    expect(ctx.repos.transfers.get(transfer.id)).toBeUndefined();
    expect(ctx.repos.transfers.listByGroup(group.id)).toEqual([]);
    expect(() => ctx.repos.transfers.remove(transfer.id, 3)).toThrow(code('NOT_FOUND'));

    ctx.repos.transfers.restore(transfer.id, 3);
    expect(ctx.repos.transfers.get(transfer.id)).toMatchObject({ amount: 700, version: 4 });
    const { balances } = ctx.repos.balances.forGroup(group.id);
    expect(balanceOf(balances, carla)).toBe(700);
  });

  it('en un grupo archivado no se agregan transferencias', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    ctx.repos.groups.archive(group.id, 1);
    expect(() =>
      ctx.repos.transfers.add({
        groupId: group.id,
        fromMemberId: ids[1] as string,
        toMemberId: ids[0] as string,
        amount: 100,
        currency: 'USD',
        occurredOn: '2026-10-09',
      }),
    ).toThrow(code('GROUP_ARCHIVED'));
  });
});
