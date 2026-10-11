import {
  checkEmailParamsSchema,
  codeFormSchema,
  resetPasswordFormSchema,
  signInFormSchema,
  signUpFormSchema,
} from '../auth-form';

const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);

describe('validación de los formularios de auth', () => {
  it('registro: recorta nombre y correo', () => {
    const parsed = signUpFormSchema.parse({
      name: '  Ana  ',
      email: ' ana@example.com ',
      password: 'ocho car',
    });
    expect(parsed).toEqual({ name: 'Ana', email: 'ana@example.com', password: 'ocho car' });
  });

  it('la contraseña se mide en bytes, como Supabase: de 8 a 72', () => {
    const check = (password: string) => issues(resetPasswordFormSchema.safeParse({ password }));
    expect(check('')).toEqual(['passwordRequired']);
    expect(check('1234567')).toEqual(['passwordTooShort']);
    expect(check('12345678')).toEqual([]);
    // 4 caracteres de 2 bytes = 8 bytes: alcanza.
    expect(check('ññññ')).toEqual([]);
    expect(check('a'.repeat(72))).toEqual([]);
    expect(check('a'.repeat(73))).toEqual(['passwordTooLong']);
    // 37 caracteres de 2 bytes = 74 bytes: no entra en bcrypt.
    expect(check('ñ'.repeat(37))).toEqual(['passwordTooLong']);
  });

  it('sin reglas de composición: una frase larga sirve', () => {
    expect(issues(resetPasswordFormSchema.safeParse({ password: 'una frase larga' }))).toEqual([]);
  });

  it('correo: requerido, válido y de hasta 254 caracteres', () => {
    const check = (email: string) => issues(signInFormSchema.safeParse({ email, password: 'x' }));
    expect(check('')).toEqual(['emailRequired']);
    expect(check('ana@')).toEqual(['emailInvalid']);
    expect(check(`${'a'.repeat(250)}@b.co`)).toEqual(['emailTooLong']);
    expect(check('ana@example.com')).toEqual([]);
  });

  it('entrar no revisa el largo de la contraseña', () => {
    expect(issues(signInFormSchema.safeParse({ email: 'ana@example.com', password: 'x' }))).toEqual(
      [],
    );
  });

  it('código: exactamente 6 dígitos', () => {
    const check = (code: string) => issues(codeFormSchema.safeParse({ code }));
    expect(check('123456')).toEqual([]);
    expect(check('12345')).toEqual(['codeInvalid']);
    expect(check('1234567')).toEqual(['codeInvalid']);
    expect(check('12345a')).toEqual(['codeInvalid']);
  });

  it('parámetros de "Revisa tu correo": flujo conocido y correo válido', () => {
    expect(checkEmailParamsSchema.safeParse({ flow: 'signup', email: 'a@b.co' }).success).toBe(
      true,
    );
    expect(checkEmailParamsSchema.safeParse({ flow: 'otro', email: 'a@b.co' }).success).toBe(false);
    expect(checkEmailParamsSchema.safeParse({ flow: 'recovery', email: 'x' }).success).toBe(false);
  });
});
