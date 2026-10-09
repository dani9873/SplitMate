import { useCallback, useEffect, useEffectEvent, useState, type DependencyList } from 'react';

import { logger } from '@/lib/logger';

import type { TableName } from './changes';
import { useDatabase } from './DatabaseProvider';
import type { Repositories } from './repositories';

export interface LiveQueryScope {
  /** Tablas que lee la consulta: solo un cambio en ellas la repite. */
  readonly tables: readonly TableName[];
  /** Grupo que lee la consulta. Sin grupo, cualquier grupo la afecta. */
  readonly groupId?: string;
}

export type LiveQueryState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly error: unknown };

export type LiveQuery<T> = LiveQueryState<T> & { readonly retry: () => void };

/**
 * Lee de los repositorios y vuelve a leer cuando el bus de cambios avisa una escritura que
 * toca las tablas y el grupo de `scope`.
 *
 * La primera lectura ocurre después del primer render, así la pantalla muestra su estado de
 * carga y la transición no espera a la consulta. Si la lectura falla, el estado es `error`
 * y `retry` la repite. `deps` son los valores de los que depende `read`, como en `useMemo`.
 */
export function useLiveQuery<T>(
  read: (repos: Repositories) => T,
  scope: LiveQueryScope,
  deps: DependencyList = [],
): LiveQuery<T> {
  const { repos } = useDatabase();
  const [state, setState] = useState<LiveQueryState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Siempre lee con la última versión de `read`, sin volver a suscribirse en cada render.
  const readLatest = useEffectEvent(() => read(repos));
  const tablesKey = scope.tables.join(',');
  const { groupId } = scope;

  useEffect(() => {
    let active = true;
    const tables = tablesKey.split(',') as TableName[];
    const run = () => {
      try {
        const data = readLatest();
        if (active) {
          setState({ status: 'ready', data });
        }
      } catch (error) {
        logger.error('Falló una lectura de la base local', error);
        if (active) {
          setState({ status: 'error', error });
        }
      }
    };
    run();
    const unsubscribe = repos.changes.subscribe((change) => {
      if (change.affects({ tables, groupId })) {
        run();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
    // `deps` son los valores de los que depende `read`: cuando cambian, se lee otra vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, attempt, tablesKey, groupId, ...deps]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, retry };
}
