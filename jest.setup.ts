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

// expo-sqlite es nativo: las pruebas usan sql.js y solo necesitan el aviso de cambios.
jest.mock('expo-sqlite', () => ({
  addDatabaseChangeListener: () => ({ remove: () => {} }),
}));
