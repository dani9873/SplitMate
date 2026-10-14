const { beforeEach, describe, expect, it, jest } = require('@jest/globals');

const { createSqlBabelTransformer, sqlToModule } = require('../sql-module');

const evaluate = (code) => {
  const module = { exports: undefined };
  new Function('module', code)(module);
  return module.exports;
};

const SQL =
  "-- Comentario con 'comillas' y `acentos` ñ\nUPDATE `x` SET `y` = 'a\"b\\c' WHERE `z` IS NULL;\n";

describe('sqlToModule', () => {
  it('exporta el texto exacto del archivo', () => {
    expect(evaluate(sqlToModule(SQL))).toBe(SQL);
  });

  it('escapa U+2028 y U+2029, que no todos los motores aceptan dentro de un string', () => {
    const [lineSeparator, paragraphSeparator] = [0x2028, 0x2029].map((c) => String.fromCharCode(c));
    const text = `a${lineSeparator}b${paragraphSeparator}c`;
    const code = sqlToModule(text);
    expect(code).not.toContain(lineSeparator);
    expect(code).not.toContain(paragraphSeparator);
    expect(evaluate(code)).toBe(text);
  });
});

describe('createSqlBabelTransformer (Metro)', () => {
  const upstream = {
    transform: jest.fn((props) => ({ ast: props.src })),
    getCacheKey: jest.fn(() => 'expo'),
  };
  const transformer = createSqlBabelTransformer(upstream);

  beforeEach(() => upstream.transform.mockClear());

  it('convierte cada .sql en su propio módulo antes de pasarlo a Babel', () => {
    transformer.transform({ filename: '/repo/src/db/migrations/0003.sql', src: SQL, options: {} });
    const props = upstream.transform.mock.calls[0][0];
    expect(props.filename).toBe('/repo/src/db/migrations/0003.sql');
    expect(evaluate(props.src)).toBe(SQL);
  });

  it('deja pasar sin cambios los demás archivos', () => {
    const props = { filename: '/repo/app/index.tsx', src: 'export default 1;', options: {} };
    transformer.transform(props);
    expect(upstream.transform).toHaveBeenCalledWith(props);
  });

  it('cambia la clave de caché respecto de la de Expo', () => {
    expect(transformer.getCacheKey()).not.toBe('expo');
    expect(transformer.getCacheKey()).toContain('expo');
  });
});
