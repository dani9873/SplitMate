import { logger } from '@/lib/logger';

/** Tablas sincronizables, con su nombre en SQL. */
export type TableName =
  | 'users'
  | 'groups'
  | 'group_members'
  | 'categories'
  | 'expenses'
  | 'expense_payers'
  | 'expense_splits'
  | 'transfers';

/**
 * Quién escribió: la app (`local`) o la sincronización (`sync`, Fase 4). La cola de envío
 * de la sincronización ignorará sus propios cambios por este campo.
 */
export type ChangeSource = 'local' | 'sync';

export interface ChangeScope {
  readonly tables: readonly TableName[];
  /** Sin grupo, la lectura depende de datos de todos los grupos. */
  readonly groupId?: string;
}

export interface DataChange {
  readonly source: ChangeSource;
  readonly tables: ReadonlySet<TableName>;
  /** Grupos afectados; `null` si el cambio no se limita a grupos concretos. */
  readonly groupIds: ReadonlySet<string> | null;
  /** Verdadero si una lectura con este alcance debe repetirse. */
  affects(scope: ChangeScope): boolean;
}

export interface ChangeInput {
  readonly source: ChangeSource;
  readonly tables: readonly TableName[];
  readonly groupIds: readonly string[] | null;
}

export type ChangeListener = (change: DataChange) => void;

export interface ChangeBus {
  /** Avisa de un cambio ya confirmado. Dentro de `batch`, espera a que el lote termine. */
  emit(change: ChangeInput): void;
  /**
   * Ejecuta `fn` y fusiona todas sus emisiones en un solo cambio al terminar. Si `fn` lanza,
   * descarta lo acumulado: un cambio que no se confirmó no se anuncia.
   */
  batch<T>(fn: () => T): T;
  /** Devuelve la función para cancelar la suscripción. */
  subscribe(listener: ChangeListener): () => void;
}

function toChange(
  source: ChangeSource,
  tables: Set<TableName>,
  groupIds: Set<string> | null,
): DataChange {
  return {
    source,
    tables,
    groupIds,
    affects: ({ tables: watched, groupId }) =>
      watched.some((table) => tables.has(table)) &&
      (groupId === undefined || groupIds === null || groupIds.has(groupId)),
  };
}

interface Pending {
  source: ChangeSource;
  tables: Set<TableName>;
  groupIds: Set<string> | null;
}

/**
 * Único mecanismo de aviso de cambios de datos. Los repositorios emiten después de confirmar
 * cada transacción, y las pantallas vuelven a leer con `useLiveQuery`. La sincronización
 * de la Fase 4 usará el mismo bus con `source: 'sync'`. Detalles en `design/fase-2/diseno.md`.
 */
export function createChangeBus(
  log: (message: string, error: unknown) => void = logger.error,
): ChangeBus {
  const listeners = new Set<ChangeListener>();
  let depth = 0;
  let pending: Pending | null = null;

  function deliver(change: DataChange) {
    for (const listener of [...listeners]) {
      try {
        listener(change);
      } catch (error) {
        log('Un suscriptor del bus de cambios falló', error);
      }
    }
  }

  function accumulate(input: ChangeInput) {
    if (!pending) {
      pending = { source: input.source, tables: new Set(), groupIds: new Set() };
    }
    if (input.source === 'local') {
      pending.source = 'local';
    }
    input.tables.forEach((table) => pending?.tables.add(table));
    if (input.groupIds === null) {
      pending.groupIds = null;
    } else {
      input.groupIds.forEach((id) => pending?.groupIds?.add(id));
    }
  }

  return {
    emit(input) {
      if (depth > 0) {
        accumulate(input);
        return;
      }
      deliver(
        toChange(input.source, new Set(input.tables), input.groupIds && new Set(input.groupIds)),
      );
    },

    batch(fn) {
      depth += 1;
      let completed = false;
      try {
        const result = fn();
        completed = true;
        return result;
      } finally {
        depth -= 1;
        if (depth === 0) {
          const collected = pending;
          pending = null;
          if (completed && collected) {
            deliver(toChange(collected.source, collected.tables, collected.groupIds));
          }
        }
        // Si falla un lote interno y el externo lo captura, lo acumulado se conserva: avisar
        // de más solo provoca una lectura extra; avisar de menos dejaría pantallas viejas.
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
