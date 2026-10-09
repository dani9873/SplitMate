// Configuración común de Jest. Los mocks de aquí aplican a todas las pruebas.

// Insets de área segura fijos: en Jest no hay pantalla real.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
