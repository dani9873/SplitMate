import en from '../locales/en.json';
import es from '../locales/es.json';

type Tree = { [key: string]: string | Tree };
const keys = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );

it('los textos de desarrollo tienen las mismas claves en español e inglés', () => {
  expect(keys(es).sort()).toEqual(keys(en).sort());
});
