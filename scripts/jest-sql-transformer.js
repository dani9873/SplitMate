// Jest: las migraciones .sql como módulos propios, igual que en Metro (scripts/sql-module.js).
const { sqlToModule } = require('./sql-module');

module.exports = {
  process(sourceText) {
    return { code: sqlToModule(sourceText) };
  },
};
