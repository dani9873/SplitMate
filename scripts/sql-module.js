// Las migraciones .sql de Drizzle como módulos propios (`module.exports = "<texto>"`), en Metro y en
// Jest: cada archivo se cachea por su contenido y Metro lo recarga al cambiar. Antes,
// babel-plugin-inline-import las incrustaba en migrations.js y Metro no sabía que dependía de ellas:
// el 2026-10-13 el teléfono corrió una 0003 vieja desde la caché (la plantilla vacía de drizzle-kit)
// y expo-sqlite se cerró (design/fase-3/crash-migracion-0003.md).

/** Código de un módulo CommonJS que exporta el texto tal cual. */
function sqlToModule(source) {
  // JSON es un literal de JS válido salvo U+2028 y U+2029: se escriben escapados.
  // String.fromCharCode(92) es la barra invertida del escape.
  let literal = JSON.stringify(source);
  for (const code of [0x2028, 0x2029]) {
    const escaped = `${String.fromCharCode(92)}u${code.toString(16)}`;
    literal = literal.split(String.fromCharCode(code)).join(escaped);
  }
  return `module.exports = ${literal};\n`;
}

/** Envuelve el transformador de Babel de Metro: los .sql pasan como módulo; lo demás, igual. */
function createSqlBabelTransformer(upstream) {
  return {
    ...upstream,
    transform(props) {
      if (props.filename.endsWith('.sql')) {
        return upstream.transform({ ...props, src: sqlToModule(props.src) });
      }
      return upstream.transform(props);
    },
    // Otra clave: Metro descarta lo que cacheó con el transformador anterior.
    getCacheKey(...args) {
      const base = typeof upstream.getCacheKey === 'function' ? upstream.getCacheKey(...args) : '';
      return `${base}:splitmate-sql-module-1`;
    },
  };
}

module.exports = { createSqlBabelTransformer, sqlToModule };
