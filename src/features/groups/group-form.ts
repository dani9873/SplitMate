import { z } from 'zod';

import { MAX_MEMBERS } from '@/db/repositories';
import { GROUP_COLORS } from '@/lib/group-appearance';

/** Claves de `groups.form.errors.*`: el formulario las traduce. */
export type GroupFormError =
  'nameRequired' | 'tooLong' | 'yourNameRequired' | 'duplicate' | 'tooMany';

const name = (required: GroupFormError) =>
  z
    .string()
    .trim()
    .min(1, required)
    .max(80, 'tooLong' satisfies GroupFormError);

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export const appearanceSchema = z.object({
  name: name('nameRequired'),
  currency: z.string().length(3),
  emoji: z.string().nullable(),
  color: z.enum(GROUP_COLORS),
});

/** Formulario de nuevo grupo: datos, tu nombre y las demás personas. */
export const createGroupFormSchema = appearanceSchema
  .extend({
    yourName: name('yourNameRequired'),
    others: z.array(
      z.object({
        name: z
          .string()
          .trim()
          .max(80, 'tooLong' satisfies GroupFormError),
      }),
    ),
  })
  .superRefine((form, ctx) => {
    const names = [form.yourName, ...form.others.map((o) => o.name)].filter((n) => n.trim());
    if (names.length > MAX_MEMBERS) {
      ctx.addIssue({
        code: 'custom',
        message: 'tooMany' satisfies GroupFormError,
        path: ['others'],
      });
    }
    form.others.forEach((other, index) => {
      if (!other.name.trim()) {
        return;
      }
      const earlier = [form.yourName, ...form.others.slice(0, index).map((o) => o.name)];
      if (earlier.some((previous) => sameName(previous, other.name))) {
        ctx.addIssue({
          code: 'custom',
          message: 'duplicate' satisfies GroupFormError,
          path: ['others', index, 'name'],
        });
      }
    });
  });

export type CreateGroupForm = z.infer<typeof createGroupFormSchema>;
export type AppearanceForm = z.infer<typeof appearanceSchema>;

/** Nombres no vacíos de las demás personas, sin espacios sobrantes. */
export function otherMemberNames(form: CreateGroupForm): string[] {
  return form.others.map((o) => o.name.trim()).filter(Boolean);
}

/** Verdadero si `candidate` ya está entre `existing`, sin distinguir mayúsculas. */
export function isDuplicateName(candidate: string, existing: readonly string[]): boolean {
  return existing.some((name) => sameName(name, candidate));
}
