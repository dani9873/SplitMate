import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useDatabase } from '@/db/DatabaseProvider';

import { createAppSyncEngine, type AppSyncEngineDeps } from './app-engine';
import type { SyncEngine } from './engine';
import type { SyncStatus } from './status';

const SyncEngineContext = createContext<SyncEngine | null>(null);

/** Entrega un motor ya creado a las pantallas. `SyncProvider` lo crea y lo arranca; las pruebas, este. */
export function SyncEngineProvider({
  engine,
  children,
}: {
  engine: SyncEngine;
  children: ReactNode;
}) {
  return <SyncEngineContext.Provider value={engine}>{children}</SyncEngineContext.Provider>;
}

export function useSyncEngine(): SyncEngine {
  const engine = useContext(SyncEngineContext);
  if (!engine) {
    throw new Error('useSyncEngine solo se puede usar dentro de SyncProvider');
  }
  return engine;
}

/** Estado de la sincronización; la pantalla se redibuja solo cuando cambia. */
export function useSyncStatus(): SyncStatus {
  const engine = useSyncEngine();
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus);
}

export interface SyncProviderProps {
  readonly ensureProfile: AppSyncEngineDeps['ensureProfile'];
  /** Solo para pruebas: por omisión, el motor real de la app. */
  readonly createEngine?: (deps: AppSyncEngineDeps) => SyncEngine;
  readonly children: ReactNode;
}

/**
 * Crea el motor con la base y el bus de la cuenta, lo arranca y lo detiene al desmontarse. Vive
 * dentro de `DatabaseGate`, que a su vez solo existe con sesión: sin sesión no hay motor. Al volver
 * la app al primer plano pide un ciclo.
 */
export function SyncProvider({
  ensureProfile,
  createEngine = createAppSyncEngine,
  children,
}: SyncProviderProps) {
  const { db, bus } = useDatabase();
  const [engine] = useState(() => createEngine({ db, bus, ensureProfile }));

  useEffect(() => {
    engine.start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        engine.request('foreground');
      }
    });
    return () => {
      subscription.remove();
      engine.stop();
    };
  }, [engine]);

  return <SyncEngineProvider engine={engine}>{children}</SyncEngineProvider>;
}
