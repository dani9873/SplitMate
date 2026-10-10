// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_esquema_inicial.sql';
import m0001 from './0001_categorias_predefinidas.sql';
import m0002 from './0002_grupos_apariencia_y_ajustes_locales.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002
    }
  }
  