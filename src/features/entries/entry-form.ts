import { z } from 'zod';

import type {
  AddExpenseInput,
  AddTransferInput,
  ExpenseWithParts,
  TransferRow,
} from '@/db/repositories';
import {
  convert,
  currencyCode,
  DomainError,
  evaluateAmount,
  money,
  parseRate,
  splitAmount,
  type AmountProblem,
  type CurrencyCode,
  type Money,
  type SplitMethod,
  toDecimalString,
} from '@/domain';
import { isCalendarDate, type CalendarDate } from '@/lib/calendar-date';

export type EntryType = 'expense' | 'income' | 'transfer';
export const SPLIT_METHODS: readonly SplitMethod[] = ['equal', 'exact', 'percentage', 'shares'];

/**
 * Estado del formulario de movimiento. Los montos son expresiones del teclado (`12.5+8`),
 * los porcentajes y la tasa son texto como se escribió, y lo que depende de cada miembro se
 * guarda por su id.
 */
export interface EntryFormValues {
  type: EntryType;
  expression: string;
  currency: string;
  rate: string;
  title: string;
  categoryId: string | null;
  occurredOn: CalendarDate;
  multiplePayers: boolean;
  payerId: string | null;
  payerExpressions: Record<string, string>;
  splitMethod: SplitMethod;
  participants: Record<string, boolean>;
  exactExpressions: Record<string, string>;
  percents: Record<string, string>;
  shares: Record<string, number>;
  fromId: string | null;
  toId: string | null;
}

export interface EntryContext {
  readonly groupId: string;
  readonly groupCurrency: string;
  /** Miembros que el formulario puede mencionar, en orden de creación. */
  readonly memberIds: readonly string[];
}

export type EntryField = 'expression' | 'title' | 'rate' | 'payers' | 'split' | 'transfer';

export type EntryProblem =
  | { readonly field: 'expression'; readonly code: AmountProblem }
  | { readonly field: 'title'; readonly code: 'required' | 'tooLong' }
  | { readonly field: 'rate'; readonly code: 'rateRequired' | 'rateInvalid' }
  | {
      readonly field: 'payers' | 'split';
      readonly code: 'remaining' | 'excess';
      readonly amount: Money;
    }
  | { readonly field: 'payers'; readonly code: 'invalidAmount' | 'missingPayer' }
  | {
      readonly field: 'split';
      readonly code: 'noParticipants' | 'noShares' | 'percentInvalid' | 'invalidAmount';
    }
  | {
      readonly field: 'split';
      readonly code: 'percentRemaining' | 'percentExcess';
      readonly basisPoints: number;
    }
  | { readonly field: 'transfer'; readonly code: 'sameMember' | 'missingMember' };

export interface EntryEvaluation {
  readonly problems: readonly EntryProblem[];
  /** Total en la moneda del movimiento, si el monto es válido. */
  readonly total: Money | null;
  /** Total en la moneda del grupo, si la moneda es otra y la tasa es válida. */
  readonly converted: Money | null;
  /** Lo que le toca a cada miembro, en la moneda del movimiento, si la división cuadra. */
  readonly shares: ReadonlyMap<string, Money>;
  /** Entrada para el repositorio, solo si no hay problemas. */
  readonly input:
    | { readonly kind: 'entry'; readonly value: AddExpenseInput }
    | { readonly kind: 'transfer'; readonly value: AddTransferInput }
    | null;
}

const MAX_TITLE = 120;
const BASIS_POINTS_TOTAL = 10_000;
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/** Acepta coma o punto como separador decimal, sin espacios. */
export function normalizeDecimal(text: string): string {
  return text.trim().replace(',', '.');
}

/** `"33,33"` → 3333 puntos básicos; `null` si no es un porcentaje con hasta dos decimales. */
export function percentToBasisPoints(text: string): number | null {
  const value = normalizeDecimal(text);
  if (value === '') {
    return 0;
  }
  if (!PERCENT_PATTERN.test(value)) {
    return null;
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 3333 puntos básicos → `"33.33"`; 5000 → `"50"`. */
export function basisPointsToPercent(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}

/** Monto de una fila por miembro: vacío o cero cuentan como cero; si no, debe ser válido. */
function memberAmount(expression: string | undefined, currency: CurrencyCode): number | null {
  const text = (expression ?? '').trim();
  if (text === '' || /^0*\.?0*$/.test(text)) {
    return 0;
  }
  const result = evaluateAmount(text, currency);
  return result.ok ? result.value.amount : null;
}

function difference(
  expected: Money,
  actual: number,
  field: 'payers' | 'split',
): EntryProblem | null {
  const gap = expected.amount - actual;
  if (gap === 0) {
    return null;
  }
  return {
    field,
    code: gap > 0 ? 'remaining' : 'excess',
    amount: money(Math.abs(gap), expected.currency),
  };
}

/** División elegida en el formulario, o el problema que impide calcularla. */
function buildSplit(
  values: EntryFormValues,
  context: EntryContext,
  total: Money | null,
  currency: CurrencyCode,
): { split: AddExpenseInput['split'] | null; problem: EntryProblem | null } {
  const ids = context.memberIds;
  switch (values.splitMethod) {
    case 'equal': {
      const participants = ids.filter((id) => values.participants[id]);
      return participants.length === 0
        ? { split: null, problem: { field: 'split', code: 'noParticipants' } }
        : { split: { method: 'equal', participants }, problem: null };
    }
    case 'shares': {
      const shares = ids
        .map((memberId) => ({
          memberId,
          shares: Math.max(0, Math.trunc(values.shares[memberId] ?? 0)),
        }))
        .filter((s) => s.shares > 0);
      return shares.length === 0
        ? { split: null, problem: { field: 'split', code: 'noShares' } }
        : { split: { method: 'shares', shares }, problem: null };
    }
    case 'percentage': {
      const percentages: { memberId: string; basisPoints: number }[] = [];
      for (const memberId of ids) {
        const basisPoints = percentToBasisPoints(values.percents[memberId] ?? '');
        if (basisPoints === null) {
          return { split: null, problem: { field: 'split', code: 'percentInvalid' } };
        }
        if (basisPoints > 0) {
          percentages.push({ memberId, basisPoints });
        }
      }
      if (percentages.length === 0) {
        return { split: null, problem: { field: 'split', code: 'noParticipants' } };
      }
      const sum = percentages.reduce((acc, p) => acc + p.basisPoints, 0);
      if (sum !== BASIS_POINTS_TOTAL) {
        return {
          split: null,
          problem: {
            field: 'split',
            code: sum < BASIS_POINTS_TOTAL ? 'percentRemaining' : 'percentExcess',
            basisPoints: Math.abs(BASIS_POINTS_TOTAL - sum),
          },
        };
      }
      return { split: { method: 'percentage', percentages }, problem: null };
    }
    case 'exact': {
      const amounts: { memberId: string; amount: number }[] = [];
      for (const memberId of ids) {
        const amount = memberAmount(values.exactExpressions[memberId], currency);
        if (amount === null) {
          return { split: null, problem: { field: 'split', code: 'invalidAmount' } };
        }
        if (amount > 0) {
          amounts.push({ memberId, amount });
        }
      }
      if (amounts.length === 0) {
        return { split: null, problem: { field: 'split', code: 'noParticipants' } };
      }
      const problem = total
        ? difference(
            total,
            amounts.reduce((acc, a) => acc + a.amount, 0),
            'split',
          )
        : null;
      return { split: problem ? null : { method: 'exact', amounts }, problem };
    }
  }
}

/** Pagadores (o receptores) y el problema que impide usarlos. */
function buildPayers(
  values: EntryFormValues,
  context: EntryContext,
  total: Money | null,
  currency: CurrencyCode,
): { payers: { memberId: string; amount: number }[] | null; problem: EntryProblem | null } {
  if (!values.multiplePayers) {
    const payerId =
      values.payerId && context.memberIds.includes(values.payerId) ? values.payerId : null;
    if (!payerId) {
      return { payers: null, problem: { field: 'payers', code: 'missingPayer' } };
    }
    return { payers: total ? [{ memberId: payerId, amount: total.amount }] : null, problem: null };
  }
  const payers: { memberId: string; amount: number }[] = [];
  for (const memberId of context.memberIds) {
    const amount = memberAmount(values.payerExpressions[memberId], currency);
    if (amount === null) {
      return { payers: null, problem: { field: 'payers', code: 'invalidAmount' } };
    }
    if (amount > 0) {
      payers.push({ memberId, amount });
    }
  }
  if (!total) {
    return { payers: null, problem: null };
  }
  const problem = difference(
    total,
    payers.reduce((acc, p) => acc + p.amount, 0),
    'payers',
  );
  return { payers: problem ? null : payers, problem };
}

/**
 * Evalúa el formulario completo con el dominio: devuelve los problemas por campo, la vista
 * previa (total, conversión y parte de cada uno) y, si todo cuadra, la entrada lista para el
 * repositorio. Es pura: el formulario la llama en cada cambio.
 */
export function evaluateEntry(values: EntryFormValues, context: EntryContext): EntryEvaluation {
  const problems: EntryProblem[] = [];
  const currency = currencyCode(values.currency);
  const amount = evaluateAmount(values.expression, currency);
  const total = amount.ok ? amount.value : null;
  if (!amount.ok) {
    problems.push({ field: 'expression', code: amount.problem });
  }

  // Conversión a la moneda del grupo, con la tasa escrita a mano.
  const sameCurrency = values.currency === context.groupCurrency;
  const rate = normalizeDecimal(values.rate);
  let converted: Money | null = null;
  if (!sameCurrency) {
    if (rate === '') {
      problems.push({ field: 'rate', code: 'rateRequired' });
    } else {
      try {
        parseRate(rate);
        if (total) {
          converted = convert(total, context.groupCurrency, rate);
          if (converted.amount <= 0) {
            converted = null;
            problems.push({ field: 'rate', code: 'rateInvalid' });
          }
        }
      } catch (error) {
        if (!(error instanceof DomainError)) {
          throw error;
        }
        problems.push({ field: 'rate', code: 'rateInvalid' });
      }
    }
  }
  const conversion = sameCurrency ? {} : { exchangeRate: rate, rateDate: values.occurredOn };
  const occurredOn = isCalendarDate(values.occurredOn) ? values.occurredOn : '';

  if (values.type === 'transfer') {
    const { fromId, toId } = values;
    if (
      !fromId ||
      !toId ||
      !context.memberIds.includes(fromId) ||
      !context.memberIds.includes(toId)
    ) {
      problems.push({ field: 'transfer', code: 'missingMember' });
    } else if (fromId === toId) {
      problems.push({ field: 'transfer', code: 'sameMember' });
    }
    const input =
      problems.length === 0 && total && fromId && toId
        ? {
            kind: 'transfer' as const,
            value: {
              groupId: context.groupId,
              fromMemberId: fromId,
              toMemberId: toId,
              amount: total.amount,
              currency,
              occurredOn,
              ...conversion,
            },
          }
        : null;
    return { problems, total, converted, shares: new Map(), input };
  }

  const title = values.title.trim();
  if (!title) {
    problems.push({ field: 'title', code: 'required' });
  } else if (title.length > MAX_TITLE) {
    problems.push({ field: 'title', code: 'tooLong' });
  }

  const payers = buildPayers(values, context, total, currency);
  if (payers.problem) {
    problems.push(payers.problem);
  }
  const split = buildSplit(values, context, total, currency);
  if (split.problem) {
    problems.push(split.problem);
  }

  let shares = new Map<string, Money>();
  if (total && split.split) {
    try {
      shares = new Map(
        splitAmount(total, split.split).map((part) => [
          part.memberId,
          money(part.amount, currency),
        ]),
      );
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }
      problems.push({ field: 'split', code: 'invalidAmount' });
    }
  }

  const input =
    problems.length === 0 && total && payers.payers && split.split
      ? {
          kind: 'entry' as const,
          value: {
            groupId: context.groupId,
            kind: values.type,
            title,
            amount: total.amount,
            currency,
            payers: payers.payers,
            split: split.split,
            categoryId: values.categoryId,
            occurredOn,
            ...conversion,
          },
        }
      : null;
  return { problems, total, converted, shares, input };
}

/** Primer problema de un campo, para mostrarlo junto a él. */
export function problemOf<F extends EntryField>(
  evaluation: EntryEvaluation,
  field: F,
): Extract<EntryProblem, { field: F }> | undefined {
  return evaluation.problems.find((p) => p.field === field) as
    Extract<EntryProblem, { field: F }> | undefined;
}

/** Esquema del borrador guardado. Si cambia la forma del formulario, sube `v`. */
export const entryDraftSchema = z.object({
  v: z.literal(1),
  values: z.object({
    type: z.enum(['expense', 'income', 'transfer']),
    expression: z.string().max(64),
    currency: z.string().length(3),
    rate: z.string().max(32),
    title: z.string().max(200),
    categoryId: z.string().nullable(),
    occurredOn: z.string(),
    multiplePayers: z.boolean(),
    payerId: z.string().nullable(),
    payerExpressions: z.record(z.string(), z.string().max(64)),
    splitMethod: z.enum(['equal', 'exact', 'percentage', 'shares']),
    participants: z.record(z.string(), z.boolean()),
    exactExpressions: z.record(z.string(), z.string().max(64)),
    percents: z.record(z.string(), z.string().max(8)),
    shares: z.record(z.string(), z.number().int().min(0).max(99)),
    fromId: z.string().nullable(),
    toId: z.string().nullable(),
  }),
});

export type EntryDraft = z.infer<typeof entryDraftSchema>;

/** Verdadero si el formulario tiene algo que valga la pena guardar como borrador. */
export function hasContent(values: EntryFormValues): boolean {
  return values.expression !== '' || values.title.trim() !== '';
}

interface DefaultsOptions {
  readonly type: EntryType;
  readonly currency: string;
  readonly memberIds: readonly string[];
  /** Miembro que es "yo": paga por defecto y envía las transferencias. */
  readonly meId: string | null;
  readonly today: CalendarDate;
}

/** Formulario vacío: pagas tú, se divide por igual entre todos y la fecha es hoy. */
export function defaultEntryValues({
  type,
  currency,
  memberIds,
  meId,
  today,
}: DefaultsOptions): EntryFormValues {
  const first = meId ?? memberIds[0] ?? null;
  return {
    type,
    expression: '',
    currency,
    rate: '',
    title: '',
    categoryId: null,
    occurredOn: today,
    multiplePayers: false,
    payerId: first,
    payerExpressions: {},
    splitMethod: 'equal',
    participants: Object.fromEntries(memberIds.map((id) => [id, true])),
    exactExpressions: {},
    percents: {},
    shares: Object.fromEntries(memberIds.map((id) => [id, 1])),
    fromId: first,
    toId: memberIds.find((id) => id !== first) ?? null,
  };
}

const decimal = (amount: number, currency: string) => toDecimalString(money(amount, currency));

/** Valores para editar un gasto o ingreso guardado, con la intención original de la división. */
export function valuesFromExpense(
  expense: ExpenseWithParts,
  base: EntryFormValues,
): EntryFormValues {
  const { currency } = expense;
  const byMember = <T>(make: (split: ExpenseWithParts['splits'][number]) => T) =>
    Object.fromEntries(expense.splits.map((split) => [split.memberId, make(split)]));
  const method = expense.splitMethod;
  const onlyPayer = expense.payers.length === 1 ? expense.payers[0] : undefined;
  return {
    ...base,
    type: expense.kind,
    expression: decimal(expense.amount, currency),
    currency,
    rate: expense.exchangeRate === '1' ? '' : expense.exchangeRate,
    title: expense.title,
    categoryId: expense.categoryId,
    occurredOn: expense.occurredOn,
    multiplePayers: onlyPayer === undefined,
    payerId: onlyPayer?.memberId ?? base.payerId,
    payerExpressions: Object.fromEntries(
      expense.payers.map((payer) => [payer.memberId, decimal(payer.amount, currency)]),
    ),
    splitMethod: method,
    participants:
      method === 'equal'
        ? Object.fromEntries(
            Object.keys(base.participants).map((id) => [
              id,
              expense.splits.some((s) => s.memberId === id),
            ]),
          )
        : base.participants,
    exactExpressions:
      method === 'exact' ? byMember((s) => decimal(s.inputValue ?? s.amount, currency)) : {},
    percents:
      method === 'percentage' ? byMember((s) => basisPointsToPercent(s.inputValue ?? 0)) : {},
    shares:
      method === 'shares'
        ? {
            ...Object.fromEntries(Object.keys(base.shares).map((id) => [id, 0])),
            ...byMember((s) => s.inputValue ?? 0),
          }
        : base.shares,
  };
}

/** Valores para editar una transferencia guardada. */
export function valuesFromTransfer(transfer: TransferRow, base: EntryFormValues): EntryFormValues {
  return {
    ...base,
    type: 'transfer',
    expression: decimal(transfer.amount, transfer.currency),
    currency: transfer.currency,
    rate: transfer.exchangeRate === '1' ? '' : transfer.exchangeRate,
    occurredOn: transfer.occurredOn,
    fromId: transfer.fromMemberId,
    toId: transfer.toMemberId,
  };
}
