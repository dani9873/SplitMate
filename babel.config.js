module.exports = function (api) {
  api.cache(true);
  return {
    // Las migraciones .sql no pasan por un plugin de Babel: Metro y Jest las cargan como módulos
    // propios (scripts/sql-module.js).
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
