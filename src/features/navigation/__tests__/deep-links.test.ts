import { MAX_LINK_LENGTH, resolveIncomingLink } from '../deep-links';

const CODE = '34e770dd-9ff9-416c-87fa-43b31d7ef225';

describe('enlaces que llegan desde fuera de la app', () => {
  describe('auth/callback, destino de los correos', () => {
    it.each([
      [`splitmate://auth/callback?code=${CODE}`],
      [`splitmate:///auth/callback?code=${CODE}`],
      [`/auth/callback?code=${CODE}`],
      [`splitmate://auth/callback/?code=${CODE}`],
    ])('acepta el código del enlace: %s', (link) => {
      expect(resolveIncomingLink(link)).toBe(`/auth/callback?code=${CODE}`);
    });

    it('conserva el flujo PKCE si viene en el enlace', () => {
      const flowId = '0123456789abcdef0123456789abcdef';
      expect(
        resolveIncomingLink(`splitmate://auth/callback?sb_flow_id=${flowId}&code=${CODE}`),
      ).toBe(`/auth/callback?code=${CODE}&sb_flow_id=${flowId}`);
    });

    it.each([
      ['en la consulta', 'splitmate://auth/callback?error=access_denied&error_code=otp_expired'],
      ['en el fragmento', 'splitmate://auth/callback#error=access_denied&error_code=otp_expired'],
      [
        'con descripción',
        'splitmate://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ],
      // Las dos redirecciones reales de Supabase Auth 2.197 para un enlace usado o vencido
      // (comprobadas contra el proyecto el 2026-10-13). Con PKCE, el error va en la consulta y
      // se repite en el fragmento, más `sb`, la marca de Supabase.
      [
        'del flujo PKCE (consulta y fragmento)',
        'splitmate://auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=',
      ],
      [
        'del flujo implícito (solo fragmento)',
        'splitmate://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=',
      ],
    ])('lleva el error de Supabase %s, sin la descripción', (_, link) => {
      expect(resolveIncomingLink(link)).toBe(
        '/auth/callback?error=access_denied&error_code=otp_expired',
      );
    });

    it('un error repetido con otro valor en el fragmento va al inicio', () => {
      expect(
        resolveIncomingLink(
          'splitmate://auth/callback?error=access_denied&error_code=otp_expired#error_code=otra_cosa',
        ),
      ).toBe('/');
    });

    it('la sesión en el fragmento (flujo implícito) no se acepta: la app solo canjea códigos', () => {
      expect(
        resolveIncomingLink(
          'splitmate://auth/callback#access_token=ey.x.y&expires_at=1&expires_in=3600&refresh_token=r&token_type=bearer&type=signup',
        ),
      ).toBe('/');
    });

    it.each([
      ['sin parámetros', 'splitmate://auth/callback'],
      ['código vacío', 'splitmate://auth/callback?code='],
      ['código con caracteres raros', 'splitmate://auth/callback?code=%3Cscript%3E'],
      ['código demasiado largo', `splitmate://auth/callback?code=${'a'.repeat(257)}`],
      ['flujo PKCE mal formado', `splitmate://auth/callback?code=${CODE}&sb_flow_id=xyz`],
      ['parámetro repetido', `splitmate://auth/callback?code=${CODE}&code=otro`],
      ['codificación rota', 'splitmate://auth/callback?code=%E0%A4%A'],
      ['error con mayúsculas', 'splitmate://auth/callback?error=Access_Denied'],
      [
        'descripción enorme',
        `splitmate://auth/callback?error=x&error_description=${'a'.repeat(600)}`,
      ],
      ['clave __proto__', `splitmate://auth/callback?__proto__=x&code=${CODE}&code=y`],
    ])('un callback inválido (%s) va al inicio', (_, link) => {
      expect(resolveIncomingLink(link)).toBe('/');
    });
  });

  describe('lo demás', () => {
    it('un enlace más largo que el máximo va al inicio sin interpretarlo', () => {
      const link = `splitmate://auth/callback?code=${CODE}&x=${'a'.repeat(MAX_LINK_LENGTH)}`;
      expect(resolveIncomingLink(link)).toBe('/');
    });

    it.each([
      ['splitmate://'],
      ['splitmate://groups/0199c82c-c000-7000-8000-000000000001'],
      ['splitmate://admin'],
      ['splitmate://auth%2Fcallback?code=abc'],
      ['https://evil.example/auth/callback?code=abc'],
      ['exp+splitmate://auth/callback?code=abc'],
      ['splitmate://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'],
      [''],
    ])('una ruta que la app no recibe desde fuera va al inicio: %s', (link) => {
      expect(resolveIncomingLink(link)).toBe('/');
    });
  });
});
