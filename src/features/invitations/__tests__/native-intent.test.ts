import { logger } from '@/lib/logger';

const TOKEN = 'k'.repeat(43);
const HOST = 'splitmate.example.com';

/** `redirectSystemPath` con el dominio configurado (se lee al cargar el módulo). */
function load(host?: string) {
  const previous = process.env.EXPO_PUBLIC_INVITE_HOST;
  if (host === undefined) {
    delete process.env.EXPO_PUBLIC_INVITE_HOST;
  } else {
    process.env.EXPO_PUBLIC_INVITE_HOST = host;
  }
  let result!: {
    redirect: (path: string) => string;
    peek: () => string | null;
  };
  jest.isolateModules(() => {
    const intent =
      require('../../../../app/+native-intent') as typeof import('../../../../app/+native-intent');
    const pending = require('../pending-invite') as typeof import('../pending-invite');
    result = {
      redirect: (path) => intent.redirectSystemPath({ path, initial: false }),
      peek: pending.peekPendingInvite,
    };
  });
  if (previous === undefined) {
    delete process.env.EXPO_PUBLIC_INVITE_HOST;
  } else {
    process.env.EXPO_PUBLIC_INVITE_HOST = previous;
  }
  return result;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('+native-intent: enlaces de invitación', () => {
  it('un App Link del dominio lleva a /invite y guarda el token fuera de la ruta', () => {
    const intent = load(HOST);
    const route = intent.redirect(`https://${HOST}/i#${TOKEN}`);
    expect(route).toBe('/invite');
    expect(route).not.toContain(TOKEN);
    expect(intent.peek()).toBe(TOKEN);
  });

  it('el esquema propio también, con o sin dominio configurado', () => {
    for (const host of [HOST, undefined]) {
      const intent = load(host);
      expect(intent.redirect(`splitmate://i#${TOKEN}`)).toBe('/invite');
      expect(intent.peek()).toBe(TOKEN);
    }
  });

  it('sin dominio configurado, un enlace https no entra', () => {
    const intent = load(undefined);
    expect(intent.redirect(`https://${HOST}/i#${TOKEN}`)).toBe('/');
    expect(intent.peek()).toBeNull();
  });

  it.each([
    ['otro dominio', `https://otro.example.com/i#${TOKEN}`],
    ['el dominio con usuario', `https://${HOST}@evil.example.com/i#${TOKEN}`],
    ['sin fragmento', `https://${HOST}/i`],
    ['el token en la consulta', `https://${HOST}/i?t=${TOKEN}`],
    ['un token corto', `https://${HOST}/i#${TOKEN.slice(1)}`],
    ['mal codificado', `https://${HOST}/i#%E0%A4%A`],
    ['otra ruta', `https://${HOST}/x#${TOKEN}`],
    ['enorme', `https://${HOST}/i#${TOKEN}${'a'.repeat(3000)}`],
  ])('rechaza %s: va al inicio y no guarda nada', (_name, link) => {
    const intent = load(HOST);
    expect(intent.redirect(link)).toBe('/');
    expect(intent.peek()).toBeNull();
  });

  it('un enlace inválido no borra el pendiente que ya había', () => {
    const intent = load(HOST);
    intent.redirect(`splitmate://i#${TOKEN}`);
    intent.redirect(`https://otro.example.com/i#${TOKEN}`);
    expect(intent.peek()).toBe(TOKEN);
  });

  it('los enlaces de Auth de la Fase 3 siguen pasando', () => {
    const intent = load(HOST);
    expect(intent.redirect('splitmate://auth/callback?code=abc123')).toBe(
      '/auth/callback?code=abc123',
    );
    expect(intent.redirect('/auth/callback?code=abc123')).toBe('/auth/callback?code=abc123');
    expect(intent.peek()).toBeNull();
  });

  it('el token no se escribe en ningún registro', () => {
    const logs = [
      jest.spyOn(logger, 'info').mockImplementation(() => undefined),
      jest.spyOn(logger, 'warn').mockImplementation(() => undefined),
      jest.spyOn(logger, 'error').mockImplementation(() => undefined),
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const intent = load(HOST);
    intent.redirect(`https://${HOST}/i#${TOKEN}`);
    intent.redirect(`https://${HOST}/i#${TOKEN}x`);
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    }
  });
});
