module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // Las migraciones de Drizzle se empaquetan como texto: import m0000 from './0000.sql'.
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
