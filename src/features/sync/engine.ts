import type { DataChange } from '@/db/changes';
import { SyncTransportError, type SyncNotice, type SyncRemote, type SyncStore } from '@/db/sync';

import { runSyncCycle } from './cycle';
import {
  deriveStatus,
  nextBackoff,
  sameStatus,
  type SyncStatus,
  type TransportErrorKind,
} from './status';

export type SyncTrigger = 'open' | 'foreground' | 'reconnect' | 'local-change' | 'manual';

export interface NetworkMonitor {
  /** Hay internet ahora. */
  current(): Promise<boolean>;
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Reloj y temporizadores inyectados: las pruebas los mueven a mano. */
export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SyncEngine {
  /** Empieza a escuchar escrituras y red, y sincroniza al abrir. Idempotente. */
  start(): void;
  /** Cancela temporizadores y suscripciones. Un ciclo en curso termina sin consecuencias. */
  stop(): void;
  request(trigger: SyncTrigger): void;
  /** Corre un ciclo (o espera el que corre y uno más) y devuelve el estado al terminar. */
  syncNow(): Promise<SyncStatus>;
  /** Devuelve los envíos apartados a la cola y sincroniza (también reintenta grupos retenidos). */
  retryFailed(): void;
  /** Foto estable: el mismo objeto mientras nada cambie (apta para `useSyncExternalStore`). */
  getStatus(): SyncStatus;
  subscribe(listener: () => void): () => void;
  onNotice(listener: (notice: SyncNotice) => void): () => void;
}

export interface SyncEngineDeps {
  readonly store: SyncStore;
  readonly remote: SyncRemote;
  readonly changes: { subscribe(listener: (change: DataChange) => void): () => void };
  readonly network: NetworkMonitor;
  /** Asegura el perfil remoto. `pending`: no se pudo todavía; el ciclo descarga pero no envía. */
  readonly ensureProfile: () => Promise<'synced' | 'pending'>;
  readonly scheduler: Scheduler;
  /** Número en [0, 1) para la variación de los reintentos. */
  readonly random: () => number;
  readonly options?: {
    /** Espera tras la última escritura. Por omisión, 2 s. */
    readonly debounceMs?: number;
    /** Tope desde la primera escritura sin ciclo. Por omisión, 10 s. */
    readonly maxWaitMs?: number;
    readonly pullMaxRows?: number;
  };
}

const DEFAULT_DEBOUNCE_MS = 2_000;
const DEFAULT_MAX_WAIT_MS = 10_000;

/** Fallos que reintentar puede arreglar. `protocol` y `auth` esperan a la persona o al próximo disparador. */
const RETRYABLE: ReadonlySet<TransportErrorKind> = new Set(['server', 'timeout', 'offline']);

/**
 * Decide cuándo sincronizar y qué estado mostrar. Nunca corren dos ciclos a la vez: un pedido
 * durante un ciclo deja exactamente uno más. Sin red no se llama al servidor. Las escrituras locales
 * esperan `debounceMs` desde la última (y como mucho `maxWaitMs` desde la primera); los fallos
 * transitorios se reintentan con espera creciente.
 */
export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { store, remote, changes, network, ensureProfile, scheduler, random } = deps;
  const debounceMs = deps.options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = deps.options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  let started = false;
  let online = true;
  let cycling = false;
  let rerun = false;
  let profileReady = false;
  let attempt = 0;
  let held = 0;
  let lastError: TransportErrorKind | null = null;
  let lastSyncedAt: number | null = null;
  let debounceHandle: unknown = null;
  let firstWriteAt: number | null = null;
  let retryHandle: unknown = null;
  let offChanges: (() => void) | null = null;
  let offNetwork: (() => void) | null = null;

  const statusListeners = new Set<() => void>();
  const noticeListeners = new Set<(notice: SyncNotice) => void>();
  let idleWaiters: ((status: SyncStatus) => void)[] = [];

  const compute = () =>
    deriveStatus({
      counts: store.counts(),
      online,
      held,
      lastError,
      syncing: cycling,
      lastSyncedAt,
    });
  let status = compute();

  function refresh() {
    const next = compute();
    if (sameStatus(status, next)) {
      return;
    }
    status = next;
    for (const listener of [...statusListeners]) {
      listener();
    }
  }

  function resolveIdle() {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) {
      resolve(status);
    }
  }

  function clearDebounce() {
    if (debounceHandle !== null) {
      scheduler.clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    firstWriteAt = null;
  }

  function clearRetry() {
    if (retryHandle !== null) {
      scheduler.clearTimeout(retryHandle);
      retryHandle = null;
    }
  }

  function scheduleRetry() {
    if (!started) {
      return;
    }
    clearRetry();
    attempt += 1;
    retryHandle = scheduler.setTimeout(
      () => {
        retryHandle = null;
        runNow();
      },
      nextBackoff(attempt, random),
    );
  }

  function armDebounce() {
    const now = scheduler.now();
    if (firstWriteAt === null) {
      firstWriteAt = now;
    }
    if (debounceHandle !== null) {
      scheduler.clearTimeout(debounceHandle);
    }
    const delay = Math.max(0, Math.min(debounceMs, firstWriteAt + maxWaitMs - now));
    debounceHandle = scheduler.setTimeout(() => {
      debounceHandle = null;
      firstWriteAt = null;
      runNow();
    }, delay);
  }

  function runNow() {
    clearRetry();
    if (!online) {
      refresh();
      return;
    }
    if (cycling) {
      rerun = true;
      return;
    }
    void runCycle();
  }

  async function runCycle(): Promise<void> {
    cycling = true;
    refresh();
    let failed = false;
    try {
      if (!profileReady) {
        try {
          profileReady = (await ensureProfile()) === 'synced';
        } catch {
          profileReady = false;
        }
      }
      // Sin perfil remoto el servidor rechazaría los envíos: solo se descarga.
      const cycleStore: SyncStore = profileReady ? store : { ...store, nextBatch: () => [] };
      const result = await runSyncCycle({
        store: cycleStore,
        remote,
        pullMaxRows: deps.options?.pullMaxRows,
        onNotice: (notice) => {
          for (const listener of [...noticeListeners]) {
            listener(notice);
          }
        },
      });
      held = result.held;
      lastError = null;
      if (profileReady) {
        attempt = 0;
        lastSyncedAt = scheduler.now();
      } else {
        failed = true;
        scheduleRetry();
      }
    } catch (error) {
      failed = true;
      lastError = error instanceof SyncTransportError ? error.kind : 'server';
      if (RETRYABLE.has(lastError)) {
        scheduleRetry();
      }
    }
    cycling = false;
    if (!started) {
      resolveIdle();
      return;
    }
    // Tras un fallo, el pedido pendiente espera al reintento: repetirlo ya sería insistir.
    if (rerun && !failed) {
      rerun = false;
      void runCycle();
      return;
    }
    rerun = false;
    refresh();
    resolveIdle();
  }

  function idle(): Promise<SyncStatus> {
    if (!cycling) {
      return Promise.resolve(status);
    }
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function request(trigger: SyncTrigger) {
    if (!started) {
      return;
    }
    if (trigger === 'local-change') {
      // Con un reintento en camino, este recogerá la escritura.
      if (retryHandle === null) {
        armDebounce();
      }
      return;
    }
    clearDebounce();
    runNow();
  }

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      store.retryFailed();
      offChanges = changes.subscribe((change) => {
        refresh();
        if (change.source === 'local') {
          request('local-change');
        }
      });
      let heard = false;
      offNetwork = network.subscribe((value) => {
        heard = true;
        const was = online;
        online = value;
        refresh();
        if (value && !was) {
          request('reconnect');
        }
      });
      network
        .current()
        .catch(() => true)
        .then((value) => {
          if (!started || heard) {
            return;
          }
          online = value;
          refresh();
          if (value) {
            request('open');
          }
        });
    },

    stop() {
      started = false;
      clearDebounce();
      clearRetry();
      offChanges?.();
      offNetwork?.();
      offChanges = null;
      offNetwork = null;
      rerun = false;
      resolveIdle();
    },

    request,

    syncNow() {
      request('manual');
      return idle();
    },

    retryFailed() {
      store.retryFailed();
      refresh();
      request('manual');
    },

    getStatus: () => status,

    subscribe(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },

    onNotice(listener) {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
  };
}
