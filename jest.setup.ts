// Configuración común de Jest. Los mocks de aquí aplican a todas las pruebas.

// Insets de área segura fijos: en Jest no hay pantalla real.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// AsyncStorage en memoria.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-sqlite es nativo: las pruebas usan sql.js. Los avisos de cambios van por el bus propio.
jest.mock('expo-sqlite', () => ({}));

// FlashList mide el tamaño real de la pantalla; en Jest usa medidas fijas.
require('@shopify/flash-list/jestSetup');
