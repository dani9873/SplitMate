import { DatabaseZap } from 'lucide-react-native';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { logger } from '@/lib/logger';
import { EmptyState, Screen, useAppTheme } from '@/ui';

import { appRepositoryDeps } from './app-deps';
import {
  createRepositories,
  type AppDatabase,
  type Repositories,
  type RepositoryDeps,
} from './repositories';

export interface DatabaseContextValue {
  readonly db: AppDatabase;
  readonly repos: Repositories;
}

type SetupState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: DatabaseContextValue }
  | { readonly status: 'error'; readonly error: unknown };

export interface DatabaseSetup {
  readonly state: SetupState;
  /** Verdadero desde que el primer intento terminó, bien o mal. El splash espera esto. */
  readonly settledOnce: boolean;
  retry(): void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

/** Abre la base al montar y permite reintentar si falla la apertura o una migración. */
export function useDatabaseSetup(
  open: () => Promise<AppDatabase>,
  deps: RepositoryDeps = appRepositoryDeps,
): DatabaseSetup {
  const [state, setState] = useState<SetupState>({ status: 'loading' });
  const [settledOnce, setSettledOnce] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    open().then(
      (db) => {
        if (!cancelled) {
          setState({ status: 'ready', value: { db, repos: createRepositories(db, deps) } });
          setSettledOnce(true);
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          logger.error('No se pudo abrir la base de datos local', error);
          setState({ status: 'error', error });
          setSettledOnce(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, deps, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, settledOnce, retry };
}

/** Muestra la app con la base lista, un indicador mientras abre o el error con reintento. */
export function DatabaseGate({
  database,
  children,
}: {
  database: DatabaseSetup;
  children: ReactNode;
}) {
  const { state, retry } = database;
  if (state.status === 'ready') {
    return <DatabaseContext.Provider value={state.value}>{children}</DatabaseContext.Provider>;
  }
  if (state.status === 'error') {
    return <DatabaseErrorScreen onRetry={retry} />;
  }
  return <DatabaseLoading />;
}

function DatabaseLoading() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator
        size="large"
        color={colors.primary}
        accessibilityLabel={t('database.loading')}
      />
    </View>
  );
}

function DatabaseErrorScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Screen edges={['top', 'bottom']}>
      <EmptyState
        icon={DatabaseZap}
        title={t('database.error.title')}
        description={t('database.error.description')}
        action={{ label: t('database.error.retry'), onPress: onRetry }}
      />
    </Screen>
  );
}

/** Base y repositorios para las pantallas. Solo funciona dentro de `DatabaseGate`. */
export function useDatabase(): DatabaseContextValue {
  const value = useContext(DatabaseContext);
  if (!value) {
    throw new Error('useDatabase solo se puede usar dentro de DatabaseGate');
  }
  return value;
}
