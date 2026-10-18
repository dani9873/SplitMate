import {
  buildInviteLink,
  buildSchemeInviteLink,
  findInviteToken,
  isInviteHostConfigured,
  parseInviteLink,
  resolveIncomingInvite,
} from '../invite-link';

const HOST = 'splitmate.example.com';
const TOKEN = 'A'.repeat(20) + 'b-_'.repeat(7) + '9'.repeat(2);

describe('el token de ejemplo', () => {
  it('tiene 43 caracteres base64url', () => {
    expect(TOKEN).toHaveLength(43);
    expect(TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('parseInviteLink', () => {
  it.each([
    ['el enlace https', `https://${HOST}/i#${TOKEN}`],
    ['con barra final antes del fragmento', `https://${HOST}/i/#${TOKEN}`],
    ['con el host en mayúsculas', `https://${HOST.toUpperCase()}/i#${TOKEN}`],
    ['con el esquema propio', `splitmate://i#${TOKEN}`],
    ['con el esquema propio y tres barras', `splitmate:///i#${TOKEN}`],
    ['con espacios alrededor', `  https://${HOST}/i#${TOKEN}\n`],
  ])('acepta %s', (_name, link) => {
    expect(parseInviteLink(link, { host: HOST })).toBe(TOKEN);
  });

  it('acepta el token solo si se pide (pegar en «Unirme con un enlace»)', () => {
    expect(parseInviteLink(TOKEN, { host: HOST })).toBeNull();
    expect(parseInviteLink(TOKEN, { host: HOST, allowBare: true })).toBe(TOKEN);
  });

  it.each([
    ['otro host', `https://otro.example.com/i#${TOKEN}`],
    ['un subdominio del host', `https://evil.${HOST}/i#${TOKEN}`],
    ['el host dentro del usuario', `https://${HOST}@evil.example.com/i#${TOKEN}`],
    ['otro puerto', `https://${HOST}:8443/i#${TOKEN}`],
    ['http sin cifrar', `http://${HOST}/i#${TOKEN}`],
    ['otra ruta', `https://${HOST}/otra#${TOKEN}`],
    ['una ruta más larga', `https://${HOST}/i/x#${TOKEN}`],
    ['con consulta', `https://${HOST}/i?x=1#${TOKEN}`],
    ['el token en la consulta y no en el fragmento', `https://${HOST}/i?${TOKEN}`],
    ['sin fragmento', `https://${HOST}/i`],
    ['un token corto', `https://${HOST}/i#${TOKEN.slice(1)}`],
    ['un token largo', `https://${HOST}/i#${TOKEN}A`],
    ['un token con caracteres que no son base64url', `https://${HOST}/i#${'!'.repeat(43)}`],
    ['un token con otra codificación', `https://${HOST}/i#${'%41'.repeat(43)}`],
    ['más fragmento detrás', `https://${HOST}/i#${TOKEN}#x`],
    ['el esquema propio con otra ruta', `splitmate://auth/callback#${TOKEN}`],
    ['otro esquema', `otra://i#${TOKEN}`],
    ['javascript:', `javascript:alert(1)//${HOST}/i#${TOKEN}`],
    ['texto cualquiera', 'hola'],
    ['vacío', ''],
  ])('rechaza %s', (_name, link) => {
    expect(parseInviteLink(link, { host: HOST })).toBeNull();
  });

  it('rechaza un enlace enorme sin interpretarlo', () => {
    expect(parseInviteLink(`https://${HOST}/i#${TOKEN}${'a'.repeat(5000)}`, { host: HOST })).toBe(
      null,
    );
    expect(parseInviteLink('a'.repeat(100_000), { host: HOST, allowBare: true })).toBeNull();
  });

  it('con el host sin configurar, el https no vale pero el esquema propio sí', () => {
    expect(parseInviteLink(`https://<dominio>/i#${TOKEN}`, { host: '<dominio>' })).toBeNull();
    expect(parseInviteLink(`splitmate://i#${TOKEN}`, { host: '<dominio>' })).toBe(TOKEN);
  });
});

describe('findInviteToken: texto pegado con más palabras', () => {
  it('encuentra el enlace dentro de un mensaje', () => {
    const message = `Únete a «Viaje» en SplitMate:\nhttps://${HOST}/i#${TOKEN}\nSe vence en 7 días.`;
    expect(findInviteToken(message, { host: HOST })).toBe(TOKEN);
  });

  it('encuentra el enlace con el esquema propio dentro de un mensaje', () => {
    expect(findInviteToken(`abre splitmate://i#${TOKEN} ya`, { host: HOST })).toBe(TOKEN);
  });

  it('acepta el token suelto', () => {
    expect(findInviteToken(` ${TOKEN} `, { host: HOST })).toBe(TOKEN);
  });

  it('un enlace de otro host dentro del mensaje no vale', () => {
    expect(findInviteToken(`mira https://otro.example.com/i#${TOKEN}`, { host: HOST })).toBeNull();
  });

  it('un texto enorme no se interpreta', () => {
    expect(findInviteToken(`${'x '.repeat(5000)}${TOKEN}`, { host: HOST })).toBeNull();
  });

  it('un texto sin enlace da null', () => {
    expect(findInviteToken('nada que ver', { host: HOST })).toBeNull();
  });
});

describe('resolveIncomingInvite (enlaces que entran a la app)', () => {
  it('reconoce el App Link y el esquema propio', () => {
    expect(resolveIncomingInvite(`https://${HOST}/i#${TOKEN}`, { host: HOST })).toBe(TOKEN);
    expect(resolveIncomingInvite(`splitmate://i#${TOKEN}`, { host: HOST })).toBe(TOKEN);
  });

  it('un token pelado no es un enlace', () => {
    expect(resolveIncomingInvite(TOKEN, { host: HOST })).toBeNull();
    expect(resolveIncomingInvite(`/${TOKEN}`, { host: HOST })).toBeNull();
  });

  it('un enlace de Auth no es una invitación', () => {
    expect(resolveIncomingInvite('splitmate://auth/callback?code=abc', { host: HOST })).toBeNull();
  });
});

describe('buildInviteLink', () => {
  it('arma el enlace https con el token en el fragmento', () => {
    expect(buildInviteLink(TOKEN, { host: HOST })).toBe(`https://${HOST}/i#${TOKEN}`);
  });

  it('con el host sin configurar, cae al esquema propio', () => {
    expect(buildInviteLink(TOKEN, { host: '<dominio>' })).toBe(`splitmate://i#${TOKEN}`);
    expect(buildSchemeInviteLink(TOKEN)).toBe(`splitmate://i#${TOKEN}`);
  });

  it('lo que arma se puede leer de vuelta', () => {
    const link = buildInviteLink(TOKEN, { host: HOST });
    expect(parseInviteLink(link, { host: HOST })).toBe(TOKEN);
  });

  it('no arma un enlace con un token que no es válido', () => {
    expect(() => buildInviteLink('corto', { host: HOST })).toThrow();
  });
});

describe('isInviteHostConfigured', () => {
  it.each([
    ['un dominio', 'splitmate.example.com', true],
    ['un subdominio', 'links.splitmate.app', true],
    ['el marcador', '<dominio>', false],
    ['vacío', '', false],
    ['con esquema', 'https://splitmate.example.com', false],
    ['con ruta', 'splitmate.example.com/i', false],
    ['con puerto', 'splitmate.example.com:443', false],
    ['sin punto', 'localhost', false],
    ['con espacios', 'split mate.example.com', false],
  ])('%s', (_name, host, expected) => {
    expect(isInviteHostConfigured(host)).toBe(expected);
  });
});
