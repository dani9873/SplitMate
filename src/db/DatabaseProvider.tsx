import { DatabaseZap } from 'lucide-react-native';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { logger } from '@/lib/logger';
import { EmptyState, Screen, useAppTheme } from '@/ui';

import type { OpenedDatabase } from './accounts';
import { appRepositoryDeps } from './app-deps';
import { createChangeBus, type ChangeBus } from './changes';
import {
  createRepositories,
  type AppDatabase,
  type Repositories,
  type RepositoryDeps,
} from './repositories';

export interface DatabaseContextValue {
  readonly db: AppDatabase;
  readonly repos: Repositories;
  /** El mismo bus de los repositorios: la sincronización escucha y avisa por él. */
  readonly bus: ChangeBus;
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

/**
 * Abre la base al montar y permite reintentar si falla la apertura o una migración. La cierra al
 * desmontar (al cerrar sesión) o al abrir otra.
 */
export function useDatabaseSetup(
  open: () => Promise<OpenedDatabase>,
  deps: RepositoryDeps = appRepositoryDeps,
): DatabaseSetup {
  const [state, setState] = useState<SetupState>({ status: 'loading' });
  const [settledOnce, setSettledOnce] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let opened: OpenedDatabase | null = null;
    open().then(
      (result) => {
        if (cancelled) {
          result.close();
          return;
        }
        opened = result;
        const bus = createChangeBus();
        setState({
          status: 'ready',
          value: { db: result.db, repos: createRepositories(result.db, deps, { bus }), bus },
        });
        setSettledOnce(true);
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
      const toClose = opened;
      if (toClose) {
        // Después de que las pantallas terminen de desmontarse: sus efectos aún pueden escribir.
        setTimeout(() => toClose.close(), 0);
      }
    };
  }, [open, deps, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, settledOnce, retry };
}

/**
 * Muestra la app con la base lista, un indicador mientras abre o el error con reintento. Con
 * `onReset`, el error también ofrece reiniciar los datos de este teléfono (borrarlos y volver a
 * abrir una base vacía).
 */
export function DatabaseGate({
  database,
  onReset,
  children,
}: {
  database: DatabaseSetup;
  /** Borra del teléfono la base de la cuenta. Después, la apertura crea una nueva. */
  onReset?: () => Promise<void>;
  children: ReactNode;
}) {
  const { state, retry } = database;
  if (state.status === 'ready') {
    return <DatabaseContext.Provider value={state.value}>{children}</DatabaseContext.Provider>;
  }
  if (state.status === 'error') {
    return <DatabaseErrorScreen onRetry={retry} onReset={onReset} />;
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

type ResetStep = 'idle' | 'ask' | 'sure';

function DatabaseErrorScreen({
  onRetry,
  onReset,
}: {
  onRetry: () => void;
  onReset?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<ResetStep>('idle');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const cancel = () => setStep('idle');
  const reset = async () => {
    if (!onReset || busy) {
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      await onReset();
      setStep('idle');
      onRetry();
    } catch (error) {
      logger.warn('No se pudieron reiniciar los datos de este teléfono', error);
      setFailed(true);
      setStep('idle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      {step === 'ask' ? (
        <EmptyState
          icon={DatabaseZap}
          title={t('database.error.resetTitle')}
          description={t('database.error.resetBody')}
          action={{ label: t('database.error.resetContinue'), onPress: () => setStep('sure') }}
          secondaryAction={{ label: t('common.cancel'), onPress: cancel }}
        />
      ) : step === 'sure' ? (
        <EmptyState
          icon={DatabaseZap}
          title={t('database.error.resetFinalTitle')}
          description={t('database.error.resetFinalBody')}
          action={{ label: t('database.error.resetConfirm'), onPress: () => void reset() }}
          secondaryAction={{ label: t('common.cancel'), onPress: cancel }}
        />
      ) : (
        <EmptyState
          icon={DatabaseZap}
          title={t('database.error.title')}
          description={
            failed
              ? `${t('database.error.description')}

${t('database.error.resetFailed')}`
              : t('database.error.description')
          }
          action={{ label: t('database.error.retry'), onPress: onRetry }}
          secondaryAction={
            onReset
              ? { label: t('database.error.reset'), onPress: () => setStep('ask') }
              : undefined
          }
        />
      )}
    </Screen>
  );
}

/** Entrega una base ya abierta. La app usa `DatabaseGate`; las pruebas, este proveedor. */
export function DatabaseProvider({
  value,
  children,
}: {
  value: DatabaseContextValue;
  children: ReactNode;
}) {
  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

/** Base y repositorios para las pantallas. Solo funciona dentro de `DatabaseGate`. */
export function useDatabase(): DatabaseContextValue {
  const value = useContext(DatabaseContext);
  if (!value) {
    throw new Error('useDatabase solo se puede usar dentro de DatabaseGate');
  }
  return value;
}
