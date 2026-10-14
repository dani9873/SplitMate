import journal from './meta/_journal.json';
import m0000 from './0000_esquema_inicial.sql';
import m0001 from './0001_categorias_predefinidas.sql';
import m0002 from './0002_grupos_apariencia_y_ajustes_locales.sql';
import m0003 from './0003_gastos_sin_categoria_en_otros.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003
    }
  }
  