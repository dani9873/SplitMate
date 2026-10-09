import { z } from 'zod';

import { isKnownCurrency } from '@/domain';

const MAX_MEMBERS = 50;

const id = z.string().trim().min(1).max(64);
const label = (max: number) => z.string().trim().min(1).max(max);

export const currencySchema = z.string().refine(isKnownCurrency, 'Moneda ISO 4217 desconocida');

export const minorAmountSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Día del calendario `YYYY-MM-DD`, comprobando que la fecha exista. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Fecha inexistente');

export const rateSchema = z
  .string()
  .max(32)
  .regex(/^\d+(\.\d+)?$/, 'Tasa decimal positiva con punto');

const memberAmount = z.object({
  memberId: id,
  amount: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
});

export const splitInputSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('equal'), participants: z.array(id).min(1).max(MAX_MEMBERS) }),
  z.object({ method: z.literal('exact'), amounts: z.array(memberAmount).min(1).max(MAX_MEMBERS) }),
  z.object({
    method: z.literal('percentage'),
    percentages: z
      .array(z.object({ memberId: id, basisPoints: z.number().int() }))
      .min(1)
      .max(MAX_MEMBERS),
  }),
  z.object({
    method: z.literal('shares'),
    shares: z
      .array(z.object({ memberId: id, shares: z.number().int() }))
      .min(1)
      .max(MAX_MEMBERS),
  }),
]);

export const createUserSchema = z.object({
  displayName: label(80),
  email: z.email().optional(),
});

export const createGroupSchema = z.object({
  name: label(80),
  currency: currencySchema,
  createdBy: id,
  members: z
    .array(z.object({ displayName: label(80), userId: id.optional() }))
    .min(1)
    .max(MAX_MEMBERS),
});

export const groupNameSchema = label(80);

export const addExpenseSchema = z.object({
  groupId: id,
  kind: z.enum(['expense', 'income']).default('expense'),
  title: label(120),
  amount: minorAmountSchema,
  currency: currencySchema,
  exchangeRate: rateSchema.optional(),
  rateDate: isoDateSchema.optional(),
  payers: z.array(memberAmount).min(1).max(MAX_MEMBERS),
  split: splitInputSchema,
  categoryId: id.nullish(),
  occurredOn: isoDateSchema,
  notes: z.string().trim().max(1000).optional(),
});

export const addTransferSchema = z
  .object({
    groupId: id,
    fromMemberId: id,
    toMemberId: id,
    amount: minorAmountSchema,
    currency: currencySchema,
    exchangeRate: rateSchema.optional(),
    rateDate: isoDateSchema.optional(),
    occurredOn: isoDateSchema,
  })
  .refine((t) => t.fromMemberId !== t.toMemberId, {
    message: 'Una transferencia necesita dos miembros distintos',
    path: ['toMemberId'],
  });

export type CreateUserInput = z.input<typeof createUserSchema>;
export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type AddExpenseInput = z.input<typeof addExpenseSchema>;
export type AddTransferInput = z.input<typeof addTransferSchema>;
