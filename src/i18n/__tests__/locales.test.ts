import { fallbackLanguage, getNativeName, languages, supportedLanguages } from '../languages';

type Tree = { [key: string]: string | Tree };

/** Aplana `{ a: { b: 'x' } }` en `[['a.b', 'x']]`. */
function flatten(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value] as [string, string]] : flatten(value, path);
  });
}

const reference = new Map(flatten(languages[fallbackLanguage]));
const placeholders = (text: string) => (text.match(/{{\s*\w+\s*}}/g) ?? []).sort();

describe.each(supportedLanguages)('idioma "%s"', (code) => {
  const entries = new Map(flatten(languages[code]));

  it('tiene exactamente las mismas claves que el idioma de referencia', () => {
    expect([...entries.keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it('no deja textos vacíos', () => {
    const empty = [...entries].filter(([, value]) => value.trim() === '').map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('conserva las variables de interpolación de cada texto', () => {
    for (const [key, value] of entries) {
      expect([key, placeholders(value)]).toEqual([key, placeholders(reference.get(key) ?? '')]);
    }
  });

  it('declara su nombre nativo para el selector', () => {
    expect(getNativeName(code).length).toBeGreaterThan(0);
  });
});
