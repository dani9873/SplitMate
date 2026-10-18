/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const LINKS = path.join(ROOT, 'web', 'links');
const read = (file: string) => readFileSync(path.join(LINKS, file), 'utf8');

const page = require('../../../../web/links/app.js') as {
  tokenFromHash(hash: unknown): string | null;
  textsFor(language: unknown): { title: string; open: string };
  run(doc: FakeDocument, loc: { hash: string; href: string }, nav: unknown): void;
  TEXTS: Record<string, Record<string, string>>;
};

const TOKEN = 'w'.repeat(43);

interface FakeElement {
  textContent: string;
  hidden: boolean;
  attributes: Record<string, string>;
  listeners: Record<string, () => void>;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: () => void): void;
}
interface FakeDocument {
  documentElement: { lang: string };
  getElementById(id: string): FakeElement;
  elements: Record<string, FakeElement>;
}

function fakeDocument(): FakeDocument {
  const elements: Record<string, FakeElement> = {};
  const get = (id: string): FakeElement => {
    elements[id] ??= {
      textContent: '',
      hidden: true,
      attributes: {},
      listeners: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      },
    };
    return elements[id];
  };
  return { documentElement: { lang: '' }, getElementById: get, elements };
}

describe('página de respaldo: app.js', () => {
  it('lee el token solo si el fragmento es exactamente un token', () => {
    expect(page.tokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    for (const bad of [
      '',
      '#',
      `#${TOKEN}x`,
      `#${TOKEN.slice(1)}`,
      `${TOKEN}`,
      `#${'!'.repeat(43)}`,
    ]) {
      expect(page.tokenFromHash(bad)).toBeNull();
    }
    expect(page.tokenFromHash(undefined)).toBeNull();
    expect(page.tokenFromHash(42)).toBeNull();
  });

  it('con un token válido muestra las acciones y arma el enlace del esquema propio', () => {
    const doc = fakeDocument();
    page.run(doc, { hash: `#${TOKEN}`, href: `https://splitmate.example.com/i#${TOKEN}` }, null);
    expect(doc.elements.actions?.hidden).toBe(false);
    expect(doc.elements.invalid?.hidden).toBe(true);
    expect(doc.elements.open?.attributes.href).toBe(`splitmate://i#${TOKEN}`);
  });

  it('copiar el enlace usa el portapapeles con la dirección actual', async () => {
    const doc = fakeDocument();
    const writeText = jest.fn().mockResolvedValue(undefined);
    const href = `https://splitmate.example.com/i#${TOKEN}`;
    page.run(doc, { hash: `#${TOKEN}`, href }, { language: 'es-CO', clipboard: { writeText } });

    doc.elements.copy?.listeners.click?.();
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith(href);
    expect(doc.elements.copied?.hidden).toBe(false);
  });

  it('con un fragmento inválido solo muestra el aviso: ni acciones ni enlace', () => {
    const doc = fakeDocument();
    page.run(doc, { hash: '#malo', href: 'https://splitmate.example.com/i#malo' }, null);
    expect(doc.elements.invalid?.hidden).toBe(false);
    // Las acciones ni se tocan: siguen ocultas.
    expect(doc.elements.actions?.hidden ?? true).toBe(true);
    expect(doc.elements.open?.attributes.href).toBeUndefined();
  });

  it('usa el idioma del navegador: inglés si es inglés, español en cualquier otro caso', () => {
    expect(page.textsFor('en-US').title).toBe(page.TEXTS.en?.title);
    expect(page.textsFor('EN').title).toBe(page.TEXTS.en?.title);
    expect(page.textsFor('es-419').title).toBe(page.TEXTS.es?.title);
    expect(page.textsFor('fr').title).toBe(page.TEXTS.es?.title);
    expect(page.textsFor(undefined).title).toBe(page.TEXTS.es?.title);
    const doc = fakeDocument();
    page.run(doc, { hash: `#${TOKEN}`, href: 'x' }, { language: 'en-GB' });
    expect(doc.documentElement.lang).toBe('en');
    expect(doc.elements.open?.textContent).toBe('Open in SplitMate');
  });

  it('los dos idiomas tienen los mismos textos', () => {
    expect(Object.keys(page.TEXTS.en ?? {}).sort()).toEqual(
      Object.keys(page.TEXTS.es ?? {}).sort(),
    );
  });
});

describe('página de respaldo: archivos estáticos', () => {
  const html = read(path.join('i', 'index.html'));

  it('no carga nada de otro origen ni lleva código ni estilos en línea', () => {
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(html).not.toMatch(/<script[^>]*>[^<\s]/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<(?:iframe|img|link)[^>]+(?:src|href)=["']https?:/i);
  });

  it('no deja pasar el Referer ni se indexa', () => {
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
    expect(html).toContain('noindex');
  });

  it('_headers fija una CSP estricta y no manda el Referer', () => {
    const headers = read('_headers');
    expect(headers).toContain("default-src 'none'");
    expect(headers).toContain("script-src 'self'");
    expect(headers).toContain("style-src 'self'");
    expect(headers).not.toContain('unsafe-inline');
    expect(headers).not.toContain('unsafe-eval');
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("connect-src 'none'");
    expect(headers).toContain('Referrer-Policy: no-referrer');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toMatch(/\/\.well-known\/assetlinks\.json\n\s+Content-Type: application\/json/);
  });

  it('assetlinks.json es JSON válido, para el paquete de la app y con marcadores de huella', () => {
    const links = JSON.parse(read(path.join('.well-known', 'assetlinks.json'))) as {
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }[];
    const app = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')) as {
      expo: { android: { package: string } };
    };
    expect(links).toHaveLength(1);
    expect(links[0]?.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(links[0]?.target.namespace).toBe('android_app');
    expect(links[0]?.target.package_name).toBe(app.expo.android.package);
    const prints = links[0]?.target.sha256_cert_fingerprints ?? [];
    expect(prints).toHaveLength(2);
    // Un marcador (todavía sin la huella real) o una huella SHA-256 de 32 pares hexadecimales.
    for (const print of prints) {
      expect(print).toMatch(/^(?:<SHA-256 [^>]+>|(?:[0-9A-F]{2}:){31}[0-9A-F]{2})$/);
    }
  });

  it('app.json registra el plugin de los enlaces', () => {
    const app = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8')) as {
      expo: { plugins: unknown[] };
    };
    expect(app.expo.plugins).toContain('./plugins/with-invite-links');
  });
});
