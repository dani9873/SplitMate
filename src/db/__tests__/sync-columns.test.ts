import type { Database } from 'sql.js';

import { RepositoryError } from '../repositories/errors';
import { MAX_MINOR_AMOUNT } from '../repositories/validation';
import { createTestGroup, createTestRepositories, type TestRepositories } from '../test-utils';

const SYNC_TABLES = [
  'groups',
  'group_members',
  'categories',
  'expenses',
  'expense_payers',
  'expense_splits',
  'transfers',
] as const;

const code = (value: string) => expect.objectContaining({ code: value });

/** Deja todo al día con el servidor: ninguna fila pendiente. */
function markEverythingSynced(sqlite: Database) {
  for (const table of SYNC_TABLES) {
    sqlite.run(`UPDATE ${table} SET synced_version = version, server_version = version`);
  }
}

/** Ids de las filas pendientes (`version <> synced_version`) de una tabla. */
function pendingIds(sqlite: Database, table: string): string[] {
  const result = sqlite.exec(
    `SELECT id FROM ${table} WHERE synced_version <> version ORDER BY id`,
  )[0];
  return (result?.values ?? []).map((row) => String(row[0]));
}

function setup(options: { currency?: string } = {}) {
  return createTestRepositories().then((ctx) => ({
    ctx,
    sqlite: ctx.sqlite,
    ...createTestGroup(ctx, options),
  }));
}

function addDinner(ctx: TestRepositories, groupId: string, ids: string[], currency = 'USD') {
  return ctx.repos.expenses.add({
    groupId,
    title: 'Cena',
    amount: 3000,
    currency,
    exchangeRate: currency === 'USD' ? undefined : '1.1',
    rateDate: currency === 'USD' ? undefined : '2026-10-09',
    payers: [{ memberId: ids[0] as string, amount: 3000 }],
    split: { method: 'equal', participants: [ids[0] as string, ids[1] as string] },
    occurredOn: '2026-10-09',
  });
}

function addTransfer(ctx: TestRepositories, groupId: string, ids: string[], amount = 500) {
  return ctx.repos.transfers.add({
    groupId,
    fromMemberId: ids[1] as string,
    toMemberId: ids[0] as string,
    amount,
    currency: 'USD',
    occurredOn: '2026-10-10',
  });
}

describe('moneda del grupo en cada movimiento', () => {
  it('un gasto guarda la moneda de su grupo, distinta de la suya', async () => {
    const { ctx, group, ids } = await setup();
    const expense = addDinner(ctx, group.id, ids, 'EUR');
    expect(expense).toMatchObject({ currency: 'EUR', groupCurrency: 'USD' });
  });

  it('editar un gasto vuelve a guardar la moneda del grupo', async () => {
    const { ctx, sqlite, group, ids } = await setup();
    const expense = addDinner(ctx, group.id, ids);
    const edited = ctx.repos.expenses.update(expense.id, expense.version, {
      groupId: group.id,
      title: 'Cena',
      amount: 4000,
      currency: 'USD',
      payers: [{ memberId: ids[0] as string, amount: 4000 }],
      split: { method: 'equal', participants: [ids[0] as string] },
      occurredOn: '2026-10-09',
    });
    expect(edited.groupCurrency).toBe('USD');
    expect(sqlite.exec(`SELECT group_currency FROM expenses`)[0]?.values).toEqual([['USD']]);
  });

  it('una transferencia guarda la moneda de su grupo', async () => {
    const { ctx, group, ids } = await setup({ currency: 'EUR' });
    const transfer = ctx.repos.transfers.add({
      groupId: group.id,
      fromMemberId: ids[1] as string,
      toMemberId: ids[0] as string,
      amount: 500,
      currency: 'USD',
      exchangeRate: '0.9',
      rateDate: '2026-10-10',
      occurredOn: '2026-10-10',
    });
    expect(transfer).toMatchObject({ currency: 'USD', groupCurrency: 'EUR' });
    const edited = ctx.repos.transfers.update(transfer.id, transfer.version, {
      groupId: group.id,
      fromMemberId: ids[1] as string,
      toMemberId: ids[0] as string,
      amount: 700,
      currency: 'EUR',
      occurredOn: '2026-10-10',
    });
    expect(edited.groupCurrency).toBe('EUR');
  });

  it('restaurar un gasto cuya moneda de grupo cambió falla con CURRENCY_CHANGED', async () => {
    const { ctx, group, ids } = await setup();
    const expense = addDinner(ctx, group.id, ids);
    ctx.repos.expenses.remove(expense.id, expense.version);
    // Sin movimientos activos, el grupo puede cambiar de moneda.
    ctx.repos.groups.update(group.id, group.version, { ...group, currency: 'EUR' });

    const removed = ctx.sqlite.exec(`SELECT version FROM expenses`)[0]?.values[0]?.[0] as number;
    expect(() => ctx.repos.expenses.restore(expense.id, removed)).toThrow(code('CURRENCY_CHANGED'));
    // No quedó a medias: el gasto sigue borrado.
    expect(ctx.repos.expenses.get(expense.id)).toBeUndefined();
  });

  it('restaurar una transferencia cuya moneda de grupo cambió falla con CURRENCY_CHANGED', async () => {
    const { ctx, group, ids } = await setup();
    const transfer = addTransfer(ctx, group.id, ids);
    ctx.repos.transfers.remove(transfer.id, transfer.version);
    ctx.repos.groups.update(group.id, group.version, { ...group, currency: 'EUR' });
    const removed = ctx.sqlite.exec(`SELECT version FROM transfers`)[0]?.values[0]?.[0] as number;
    expect(() => ctx.repos.transfers.restore(transfer.id, removed)).toThrow(
      code('CURRENCY_CHANGED'),
    );
  });

  it('restaurar con la misma moneda de grupo sigue funcionando', async () => {
    const { ctx, group, ids } = await setup();
    const expense = addDinner(ctx, group.id, ids);
    ctx.repos.expenses.remove(expense.id, expense.version);
    ctx.repos.expenses.restore(expense.id, expense.version + 1);
    expect(ctx.repos.expenses.get(expense.id)).toMatchObject({ groupCurrency: 'USD' });
  });

  it('CURRENCY_CHANGED es un RepositoryError con su propio código', () => {
    expect(new RepositoryError('CURRENCY_CHANGED', 'x').code).toBe('CURRENCY_CHANGED');
  });
});

describe('monto máximo en unidades menores', () => {
  it('coincide con el del servidor', () => {
    expect(MAX_MINOR_AMOUNT).toBe(99_999_999_999_999);
  });

  it('acepta el máximo y rechaza una unidad más', async () => {
    const { ctx, group, ids } = await setup();
    const expense = (amount: number) => () =>
      ctx.repos.expenses.add({
        groupId: group.id,
        title: 'Grande',
        amount,
        currency: 'USD',
        payers: [{ memberId: ids[0] as string, amount }],
        split: { method: 'equal', participants: [ids[0] as string] },
        occurredOn: '2026-10-09',
      });
    expect(expense(MAX_MINOR_AMOUNT)).not.toThrow();
    expect(expense(MAX_MINOR_AMOUNT + 1)).toThrow(code('VALIDATION'));
  });

  it('también limita las transferencias', async () => {
    const { ctx, group, ids } = await setup();
    expect(() => addTransfer(ctx, group.id, ids, MAX_MINOR_AMOUNT + 1)).toThrow(code('VALIDATION'));
    expect(() => addTransfer(ctx, group.id, ids, MAX_MINOR_AMOUNT)).not.toThrow();
  });
});

describe('pendiente = version distinta de synced_version', () => {
  it('lo creado queda pendiente y sin versión del servidor', async () => {
    const { ctx, sqlite, group, ids } = await setup();
    const expense = addDinner(ctx, group.id, ids);
    addTransfer(ctx, group.id, ids);
    expect(pendingIds(sqlite, 'groups')).toEqual([group.id]);
    expect(pendingIds(sqlite, 'group_members')).toHaveLength(3);
    expect(pendingIds(sqlite, 'expenses')).toEqual([expense.id]);
    expect(pendingIds(sqlite, 'expense_payers')).toHaveLength(1);
    expect(pendingIds(sqlite, 'expense_splits')).toHaveLength(2);
    expect(pendingIds(sqlite, 'transfers')).toHaveLength(1);
    // Las predefinidas vienen sincronizadas de la migración.
    expect(pendingIds(sqlite, 'categories')).toEqual([]);
    expect(
      sqlite.exec(`SELECT count(*) FROM expenses WHERE server_version IS NULL`)[0]?.values,
    ).toEqual([[1]]);
  });

  it('cada escritura de un gasto vuelve a dejarlo pendiente, con sus pagadores y partes', async () => {
    const { ctx, sqlite, group, ids } = await setup();
    const expense = addDinner(ctx, group.id, ids);
    markEverythingSynced(sqlite);
    expect(pendingIds(sqlite, 'expenses')).toEqual([]);

    ctx.repos.expenses.remove(expense.id, expense.version);
    expect(pendingIds(sqlite, 'expenses')).toEqual([expense.id]);
    expect(pendingIds(sqlite, 'expense_payers')).toHaveLength(1);
    expect(pendingIds(sqlite, 'expense_splits')).toHaveLength(2);

    markEverythingSynced(sqlite);
    ctx.repos.expenses.restore(expense.id, expense.version + 1);
    expect(pendingIds(sqlite, 'expenses')).toEqual([expense.id]);
    expect(pendingIds(sqlite, 'expense_splits')).toHaveLength(2);
    // Lo que no cambió sigue al día.
    expect(pendingIds(sqlite, 'groups')).toEqual([]);
    expect(pendingIds(sqlite, 'group_members')).toEqual([]);
  });

  it('cada escritura de una transferencia la deja pendiente', async () => {
    const { ctx, sqlite, group, ids } = await setup();
    const transfer = addTransfer(ctx, group.id, ids);
    markEverythingSynced(sqlite);
    ctx.repos.transfers.remove(transfer.id, transfer.version);
    expect(pendingIds(sqlite, 'transfers')).toEqual([transfer.id]);
    markEverythingSynced(sqlite);
    ctx.repos.transfers.restore(transfer.id, transfer.version + 1);
    expect(pendingIds(sqlite, 'transfers')).toEqual([transfer.id]);
  });

  it('renombrar un grupo deja pendiente solo el grupo', async () => {
    const { ctx, sqlite, group } = await setup();
    markEverythingSynced(sqlite);
    ctx.repos.groups.rename(group.id, group.version, 'Otro nombre');
    expect(pendingIds(sqlite, 'groups')).toEqual([group.id]);
    expect(pendingIds(sqlite, 'group_members')).toEqual([]);
  });

  it('elegir "soy yo" (setCurrentMember) deja pendientes los dos miembros afectados', async () => {
    const { ctx, sqlite, group, ids } = await setup();
    markEverythingSynced(sqlite);
    // Ana es el "yo"; pasar a Beto desvincula a Ana y vincula a Beto.
    ctx.repos.members.setCurrentMember(group.id, ids[1] as string);
    expect(pendingIds(sqlite, 'group_members').sort()).toEqual([ids[0], ids[1]].sort());
    expect(pendingIds(sqlite, 'groups')).toEqual([]);
  });
});
