import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

/**
 * Ruta de la pantalla de desarrollo. En producción `__DEV__` es `false`, Metro elimina la
 * rama y con ella el `require`: la pantalla, sus datos de ejemplo y sus textos no entran
 * al bundle. `npm run check:bundle` lo verifica en CI.
 */
const DevRoute: ComponentType = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/features/dev').DevScreen
  : function ProductionDevRoute() {
      return <Redirect href="/" />;
    };

export default DevRoute;
