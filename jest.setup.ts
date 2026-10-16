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

// FlashList mide el tamaño real de la pantalla; en Jest usa medidas fijas. Su jestSetup.js
// reemplaza FlashList por RecyclerView, que la versión 2.0.2 ya no exporta, así que aquí
// solo se simulan las medidas y se usa la lista real.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => ({
  ...jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout'),
  measureParentSize: () => ({ x: 0, y: 0, width: 400, height: 2000 }),
  measureFirstChildLayout: () => ({ x: 0, y: 0, width: 400, height: 2000 }),
  measureItemLayout: () => ({ x: 0, y: 0, width: 400, height: 60 }),
}));

// El motor real de sincronización habla con Supabase y la red del sistema. En las pruebas de
// pantallas es uno falso que, como el real, asegura el perfil remoto al arrancar. Las pruebas del
// motor usan el suyo (`createSyncEngine`) y el proveedor recibe `createEngine` por propiedad.
jest.mock('@/features/sync/app-engine', () => ({
  createAppSyncEngine: ({ ensureProfile }: { ensureProfile: () => Promise<unknown> }) => {
    const { createFakeSyncEngine } = jest.requireActual('@/features/sync/fake-engine');
    const engine = createFakeSyncEngine();
    engine.start.mockImplementation(() => void ensureProfile());
    return engine;
  },
}));
