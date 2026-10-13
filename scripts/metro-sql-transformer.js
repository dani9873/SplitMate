// Transformador de Babel de Metro: el de Expo, con las migraciones .sql como módulos propios
// (scripts/sql-module.js). Se configura en metro.config.js.
const upstream = require('@expo/metro-config/babel-transformer');

const { createSqlBabelTransformer } = require('./sql-module');

module.exports = createSqlBabelTransformer(upstream);
