import { z } from 'zod';

/** Claves de `auth.validation.*`: los formularios las traducen. */
export type AuthValidationError =
  | 'nameRequired'
  | 'nameTooLong'
  | 'emailRequired'
  | 'emailInvalid'
  | 'emailTooLong'
  | 'passwordRequired'
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'codeInvalid';

const error = (key: AuthValidationError) => key;

/** Supabase mide la contraseña en bytes: mínimo 8 y máximo 72 (el límite de bcrypt). */
const byteLength = (value: string) => new TextEncoder().encode(value).length;
export const PASSWORD_MIN_BYTES = 8;
export const PASSWORD_MAX_BYTES = 72;

const name = z.string().trim().min(1, error('nameRequired')).max(80, error('nameTooLong'));

const email = z
  .string()
  .trim()
  .min(1, error('emailRequired'))
  .max(254, error('emailTooLong'))
  .pipe(z.email(error('emailInvalid')));

/** Contraseña nueva: solo largo, sin reglas de composición. */
const newPassword = z
  .string()
  // Vacía: solo "escribe la contraseña", sin sumar "muy corta".
  .min(1, { error: error('passwordRequired'), abort: true })
  .refine((value) => byteLength(value) >= PASSWORD_MIN_BYTES, error('passwordTooShort'))
  .refine((value) => byteLength(value) <= PASSWORD_MAX_BYTES, error('passwordTooLong'));

export const signUpFormSchema = z.object({ name, email, password: newPassword });
export type SignUpForm = z.input<typeof signUpFormSchema>;

/** Para entrar no se revisa el largo: solo que haya contraseña. */
export const signInFormSchema = z.object({
  email,
  password: z.string().min(1, error('passwordRequired')),
});
export type SignInForm = z.input<typeof signInFormSchema>;

export const forgotPasswordFormSchema = z.object({ email });
export type ForgotPasswordForm = z.input<typeof forgotPasswordFormSchema>;

export const yourNameFormSchema = z.object({ name });
export type YourNameForm = z.input<typeof yourNameFormSchema>;

export const resetPasswordFormSchema = z.object({ password: newPassword });
export type ResetPasswordForm = z.input<typeof resetPasswordFormSchema>;

export const codeFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, error('codeInvalid')),
});
export type CodeForm = z.input<typeof codeFormSchema>;

/** Correo y flujo que llegan como parámetros a "Revisa tu correo". */
export const checkEmailParamsSchema = z.object({
  flow: z.enum(['signup', 'recovery']),
  email,
});
