import type { ConflictDraft } from '@/db/repositories';
import { createTestGroup, createTestRepositories } from '@/db/test-utils';
import { money } from '@/domain';

import {
  basisPointsToPercent,
  defaultEntryValues,
  evaluateEntry,
  hasContent,
  percentToBasisPoints,
  problemOf,
  valuesFromConflictDraft,
  valuesFromExpense,
  valuesFromTransfer,
  type EntryFormValues,
} from '../entry-form';

const [ANA, BETO, CARLA] = ['a-ana', 'b-beto', 'c-carla'];
const context = { groupId: 'g1', groupCurrency: 'USD', memberIds: [ANA, BETO, CARLA] };

function form(overrides: Partial<EntryFormValues> = {}): EntryFormValues {
  return {
    ...defaultEntryValues({
      type: 'expense',
      currency: 'USD',
      memberIds: context.memberIds,
      meId: ANA,
      today: '2026-10-09',
    }),
    title: 'Cena',
    expression: '30',
    ...overrides,
  };
}

const shareAmounts = (values: EntryFormValues) =>
  Object.fromEntries(
    [...evaluateEntry(values, context).shares].map(([id, share]) => [id, share.amount]),
  );

describe('formulario de movimiento', () => {
  it('por defecto pagas tú y se divide por igual entre todos', () => {
    const result = evaluateEntry(form({ expression: '10' }), context);
    expect(result.problems).toEqual([]);
    expect(result.input).toEqual({
      kind: 'entry',
      value: {
        groupId: 'g1',
        kind: 'expense',
        title: 'Cena',
        amount: 1000,
        currency: 'USD',
        payers: [{ memberId: ANA, amount: 1000 }],
        split: { method: 'equal', participants: [ANA, BETO, CARLA] },
        categoryId: null,
        occurredOn: '2026-10-09',
      },
    });
    expect(shareAmounts(form({ expression: '10' }))).toEqual({
      [ANA]: 334,
      [BETO]: 333,
      [CARLA]: 333,
    });
  });

  it('divide por igual solo entre los marcados', () => {
    const values = form({ participants: { [ANA]: true, [BETO]: false, [CARLA]: true } });
    expect(shareAmounts(values)).toEqual({ [ANA]: 1500, [CARLA]: 1500 });
    const none = form({ participants: {} });
    expect(problemOf(evaluateEntry(none, context), 'split')).toEqual({
      field: 'split',
      code: 'noParticipants',
    });
  });

  it('divide por montos exactos y dice cuánto falta o sobra', () => {
    const exact = (beto: string) =>
      form({ splitMethod: 'exact', exactExpressions: { [ANA]: '10', [BETO]: beto, [CARLA]: '' } });
    expect(shareAmounts(exact('20'))).toEqual({ [ANA]: 1000, [BETO]: 2000 });
    expect(problemOf(evaluateEntry(exact('15'), context), 'split')).toEqual({
      field: 'split',
      code: 'remaining',
      amount: money(500, 'USD'),
    });
    expect(problemOf(evaluateEntry(exact('5*5'), context), 'split')).toEqual({
      field: 'split',
      code: 'excess',
      amount: money(500, 'USD'),
    });
    expect(problemOf(evaluateEntry(exact('5/0'), context), 'split')?.code).toBe('invalidAmount');
  });

  it('divide por porcentajes con hasta dos decimales', () => {
    const values = form({
      expression: '100',
      splitMethod: 'percentage',
      percents: { [ANA]: '33,34', [BETO]: '33.33', [CARLA]: '33,33' },
    });
    const result = evaluateEntry(values, context);
    expect(result.input?.kind === 'entry' && result.input.value.split).toEqual({
      method: 'percentage',
      percentages: [
        { memberId: ANA, basisPoints: 3334 },
        { memberId: BETO, basisPoints: 3333 },
        { memberId: CARLA, basisPoints: 3333 },
      ],
    });
    expect(shareAmounts(values)).toEqual({ [ANA]: 3334, [BETO]: 3333, [CARLA]: 3333 });

    const short = form({ splitMethod: 'percentage', percents: { [ANA]: '50', [BETO]: '25' } });
    expect(problemOf(evaluateEntry(short, context), 'split')).toEqual({
      field: 'split',
      code: 'percentRemaining',
      basisPoints: 2500,
    });
    const over = form({ splitMethod: 'percentage', percents: { [ANA]: '60', [BETO]: '50,5' } });
    expect(problemOf(evaluateEntry(over, context), 'split')).toMatchObject({
      code: 'percentExcess',
      basisPoints: 1050,
    });
    const bad = form({ splitMethod: 'percentage', percents: { [ANA]: '33,333' } });
    expect(problemOf(evaluateEntry(bad, context), 'split')?.code).toBe('percentInvalid');
  });

  it('divide por partes enteras', () => {
    const values = form({
      expression: '40',
      splitMethod: 'shares',
      shares: { [ANA]: 1, [BETO]: 3, [CARLA]: 0 },
    });
    expect(shareAmounts(values)).toEqual({ [ANA]: 1000, [BETO]: 3000 });
    const none = form({ splitMethod: 'shares', shares: { [ANA]: 0 } });
    expect(problemOf(evaluateEntry(none, context), 'split')?.code).toBe('noShares');
  });

  it('con varios pagadores exige que sumen el total', () => {
    const values = (beto: string) =>
      form({ multiplePayers: true, payerExpressions: { [ANA]: '20', [BETO]: beto } });
    const ok = evaluateEntry(values('10'), context);
    expect(ok.input?.kind === 'entry' && ok.input.value.payers).toEqual([
      { memberId: ANA, amount: 2000 },
      { memberId: BETO, amount: 1000 },
    ]);
    expect(problemOf(evaluateEntry(values('5'), context), 'payers')).toEqual({
      field: 'payers',
      code: 'remaining',
      amount: money(500, 'USD'),
    });
    expect(problemOf(evaluateEntry(values('2+'), context), 'payers')?.code).toBe('invalidAmount');
    const nobody = form({ payerId: null });
    expect(problemOf(evaluateEntry(nobody, context), 'payers')?.code).toBe('missingPayer');
  });

  it('en otra moneda exige la tasa y muestra el monto convertido', () => {
    const inEur = (rate: string) => form({ expression: '10', currency: 'EUR', rate });
    expect(problemOf(evaluateEntry(inEur(''), context), 'rate')?.code).toBe('rateRequired');
    expect(problemOf(evaluateEntry(inEur('abc'), context), 'rate')?.code).toBe('rateInvalid');
    expect(problemOf(evaluateEntry(inEur('0'), context), 'rate')?.code).toBe('rateInvalid');
    expect(problemOf(evaluateEntry(inEur('0,0001'), context), 'rate')?.code).toBe('rateInvalid');

    const result = evaluateEntry(inEur('1,0853'), context);
    expect(result.converted).toEqual(money(1085, 'USD'));
    expect(result.input?.kind === 'entry' && result.input.value).toMatchObject({
      currency: 'EUR',
      amount: 1000,
      exchangeRate: '1.0853',
      rateDate: '2026-10-09',
    });
  });

  it('señala el monto, la descripción y la tasa con su problema', () => {
    const result = evaluateEntry(form({ expression: '12+', title: '  ' }), context);
    expect(problemOf(result, 'expression')).toEqual({ field: 'expression', code: 'INCOMPLETE' });
    expect(problemOf(result, 'title')).toEqual({ field: 'title', code: 'required' });
    expect(result.input).toBeNull();
    expect(problemOf(evaluateEntry(form({ title: 'x'.repeat(121) }), context), 'title')?.code).toBe(
      'tooLong',
    );
  });

  it('las transferencias necesitan dos personas distintas', () => {
    const transfer = (fromId: string | null, toId: string | null) =>
      form({ type: 'transfer', title: '', fromId, toId });
    const ok = evaluateEntry(transfer(BETO, ANA), context);
    expect(ok.input).toEqual({
      kind: 'transfer',
      value: {
        groupId: 'g1',
        fromMemberId: BETO,
        toMemberId: ANA,
        amount: 3000,
        currency: 'USD',
        occurredOn: '2026-10-09',
      },
    });
    expect(problemOf(evaluateEntry(transfer(ANA, ANA), context), 'transfer')?.code).toBe(
      'sameMember',
    );
    expect(problemOf(evaluateEntry(transfer(null, ANA), context), 'transfer')?.code).toBe(
      'missingMember',
    );
  });

  it('convierte porcentajes y puntos básicos en ambos sentidos', () => {
    expect(percentToBasisPoints('')).toBe(0);
    expect(percentToBasisPoints('12,5')).toBe(1250);
    expect(percentToBasisPoints('100')).toBe(10_000);
    expect(percentToBasisPoints('1000')).toBeNull();
    expect(percentToBasisPoints('-5')).toBeNull();
    expect(basisPointsToPercent(3333)).toBe('33.33');
    expect(basisPointsToPercent(1250)).toBe('12.5');
    expect(basisPointsToPercent(5000)).toBe('50');
    expect(basisPointsToPercent(305)).toBe('3.05');
  });

  it('sabe si hay algo que guardar como borrador', () => {
    expect(hasContent(form({ expression: '', title: '' }))).toBe(false);
    expect(hasContent(form({ expression: '', title: 'Cena' }))).toBe(true);
    expect(hasContent(form({ expression: '5', title: '' }))).toBe(true);
  });
});

describe('editar un movimiento guardado', () => {
  it('recupera la intención de cada método de división', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const [ana, beto, carla] = ids as [string, string, string];
    const groupContext = { groupId: group.id, groupCurrency: 'USD', memberIds: ids };
    const base = defaultEntryValues({
      type: 'expense',
      currency: 'USD',
      memberIds: ids,
      meId: ana,
      today: '2026-10-09',
    });
    const inputs = [
      { method: 'equal' as const, participants: [ana, carla] },
      {
        method: 'shares' as const,
        shares: [
          { memberId: ana, shares: 2 },
          { memberId: beto, shares: 1 },
        ],
      },
      {
        method: 'percentage' as const,
        percentages: [
          { memberId: ana, basisPoints: 3350 },
          { memberId: beto, basisPoints: 6650 },
        ],
      },
      {
        method: 'exact' as const,
        amounts: [
          { memberId: beto, amount: 1000 },
          { memberId: carla, amount: 2050 },
        ],
      },
    ];
    for (const split of inputs) {
      const saved = ctx.repos.expenses.add({
        groupId: group.id,
        title: 'Cena',
        amount: 3050,
        currency: 'USD',
        payers: [
          { memberId: beto, amount: 50 },
          { memberId: carla, amount: 3000 },
        ],
        split,
        occurredOn: '2026-10-08',
      });
      const values = valuesFromExpense(saved, base);
      expect(values).toMatchObject({
        expression: '30.50',
        multiplePayers: true,
        splitMethod: split.method,
      });
      const again = evaluateEntry(values, groupContext);
      expect(again.problems).toEqual([]);
      expect(again.input?.kind === 'entry' && again.input.value).toMatchObject({
        amount: 3050,
        payers: [
          { memberId: beto, amount: 50 },
          { memberId: carla, amount: 3000 },
        ],
        split,
        occurredOn: '2026-10-08',
      });
    }
  });

  it('recupera una transferencia en otra moneda', async () => {
    const ctx = await createTestRepositories();
    const { group, ids } = createTestGroup(ctx);
    const transfer = ctx.repos.transfers.add({
      groupId: group.id,
      fromMemberId: ids[1] as string,
      toMemberId: ids[0] as string,
      amount: 2000,
      currency: 'EUR',
      exchangeRate: '1.1',
      occurredOn: '2026-10-07',
    });
    const base = defaultEntryValues({
      type: 'transfer',
      currency: 'USD',
      memberIds: ids,
      meId: null,
      today: '2026-10-09',
    });
    expect(valuesFromTransfer(transfer, base)).toMatchObject({
      type: 'transfer',
      expression: '20.00',
      currency: 'EUR',
      rate: '1.1',
      occurredOn: '2026-10-07',
      fromId: ids[1],
      toId: ids[0],
    });
  });
});

describe('valuesFromConflictDraft', () => {
  const baseUsd = defaultEntryValues({
    type: 'expense',
    currency: 'USD',
    memberIds: context.memberIds,
    meId: ANA,
    today: '2026-10-09',
  });

  const draft = (
    entity: ConflictDraft['entity'],
    data: Record<string, unknown>,
  ): ConflictDraft => ({
    id: '01990000-0000-7000-8000-0000000000c1',
    entity,
    entityId: '01990000-0000-7000-8000-0000000000e1',
    groupId: 'g1',
    reason: 'conflict',
    data,
    serverDeleted: false,
    wasNew: false,
    wasDeletion: false,
    createdAt: 1,
  });

  const expenseData = (overrides: Record<string, unknown> = {}) => ({
    id: '01990000-0000-7000-8000-0000000000e1',
    group_id: 'g1',
    kind: 'expense',
    title: 'Cena',
    amount: 3050,
    currency: 'USD',
    group_currency: 'USD',
    group_amount: 3050,
    exchange_rate: '1',
    rate_date: null,
    split_method: 'equal',
    category_id: null,
    occurred_on: '2026-10-08',
    notes: null,
    deleted: false,
    payers: [{ id: 'p1', member_id: BETO, amount: 3050, group_amount: 3050 }],
    splits: [
      { id: 's1', member_id: ANA, amount: 1525, group_amount: 1525, input_value: null },
      { id: 's2', member_id: BETO, amount: 1525, group_amount: 1525, input_value: null },
    ],
    ...overrides,
  });

  it('arma el gasto del usuario: pagador, participantes, monto y fecha', () => {
    const values = valuesFromConflictDraft(draft('expense', expenseData()), baseUsd);

    expect(values).toMatchObject({
      type: 'expense',
      title: 'Cena',
      expression: '30.50',
      currency: 'USD',
      rate: '',
      occurredOn: '2026-10-08',
      multiplePayers: false,
      payerId: BETO,
      splitMethod: 'equal',
      participants: { [ANA]: true, [BETO]: true, [CARLA]: false },
    });
    const again = evaluateEntry(values as EntryFormValues, context);
    expect(again.problems).toEqual([]);
    expect(again.input?.kind === 'entry' && again.input.value).toMatchObject({
      amount: 3050,
      payers: [{ memberId: BETO, amount: 3050 }],
      split: { method: 'equal', participants: [ANA, BETO] },
    });
  });

  it('conserva división desigual y varios pagadores', () => {
    const values = valuesFromConflictDraft(
      draft(
        'expense',
        expenseData({
          split_method: 'exact',
          payers: [
            { id: 'p1', member_id: BETO, amount: 50, group_amount: 50 },
            { id: 'p2', member_id: CARLA, amount: 3000, group_amount: 3000 },
          ],
          splits: [
            { id: 's1', member_id: ANA, amount: 1000, group_amount: 1000, input_value: 1000 },
            { id: 's2', member_id: BETO, amount: 2050, group_amount: 2050, input_value: 2050 },
          ],
        }),
      ),
      baseUsd,
    );

    expect(values).toMatchObject({
      multiplePayers: true,
      payerExpressions: { [BETO]: '0.50', [CARLA]: '30.00' },
      splitMethod: 'exact',
      exactExpressions: { [ANA]: '10.00', [BETO]: '20.50' },
    });
    expect(evaluateEntry(values as EntryFormValues, context).problems).toEqual([]);
  });

  it('un ingreso en otra moneda conserva su tasa mientras la moneda del grupo no cambie', () => {
    const values = valuesFromConflictDraft(
      draft(
        'expense',
        expenseData({
          kind: 'income',
          currency: 'EUR',
          exchange_rate: '1.1',
          group_currency: 'USD',
        }),
      ),
      baseUsd,
    );
    expect(values).toMatchObject({ type: 'income', currency: 'EUR', rate: '1.1' });
  });

  it('si la moneda del grupo cambió, la tasa se vacía para escribir la nueva', () => {
    const baseEur = { ...baseUsd, currency: 'EUR' };
    const values = valuesFromConflictDraft(
      draft(
        'expense',
        expenseData({ currency: 'GBP', exchange_rate: '1.1', group_currency: 'USD' }),
      ),
      baseEur,
    );
    expect(values).toMatchObject({ currency: 'GBP', rate: '' });
  });

  it('arma la transferencia del usuario', () => {
    const values = valuesFromConflictDraft(
      draft('transfer', {
        id: '01990000-0000-7000-8000-0000000000e1',
        group_id: 'g1',
        from_member_id: BETO,
        to_member_id: ANA,
        amount: 2000,
        currency: 'EUR',
        group_currency: 'USD',
        group_amount: 2200,
        exchange_rate: '1.1',
        rate_date: null,
        occurred_on: '2026-10-07',
        deleted: false,
      }),
      { ...baseUsd, type: 'transfer' },
    );
    expect(values).toMatchObject({
      type: 'transfer',
      expression: '20.00',
      currency: 'EUR',
      rate: '1.1',
      occurredOn: '2026-10-07',
      fromId: BETO,
      toId: ANA,
    });
  });

  it('un grupo, un miembro o datos ilegibles no son un movimiento', () => {
    expect(valuesFromConflictDraft(draft('group', { name: 'Playa' }), baseUsd)).toBeNull();
    expect(valuesFromConflictDraft(draft('member', { display_name: 'Beto' }), baseUsd)).toBeNull();
    expect(
      valuesFromConflictDraft(draft('expense', expenseData({ amount: 'mucho' })), baseUsd),
    ).toBeNull();
    expect(valuesFromConflictDraft(draft('transfer', { amount: 5 }), baseUsd)).toBeNull();
  });
});
