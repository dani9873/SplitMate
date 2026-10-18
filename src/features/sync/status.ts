import type { SyncCounts, SyncTransportError } from '@/db/sync';

export type TransportErrorKind = SyncTransportError['kind'];

/**
 * Lo que ve la persona: `synced` (al día), `pending` (hay cambios por subir o un reintento en
 * camino), `offline` (sin conexión) y `error` (algo necesita atención: envíos apartados, grupos
 * retenidos o un fallo que reintentar no arregla).
 */
export type SyncState = 'synced' | 'pending' | 'offline' | 'error';

export interface SyncStatus {
  readonly state: SyncState;
  /** Hay un ciclo en curso; es independiente del estado. */
  readonly syncing: boolean;
  readonly pending: number;
  /** Envíos apartados (el servidor los rechazó como inválidos o prohibidos). */
  readonly failed: number;
  /** Borradores por revisar. */
  readonly conflicts: number;
  /** Unidades por subir en grupos a los que ya no se tiene acceso: no se enviarán. */
  readonly lost: number;
  /** Grupos cuya descarga quedó retenida por una fila que no se pudo aplicar. */
  readonly held: number;
  /** Causa del último ciclo fallido; `null` si el último salió bien. */
  readonly lastError: TransportErrorKind | null;
  readonly lastSyncedAt: number | null;
}

export interface StatusInput {
  readonly counts: SyncCounts;
  readonly online: boolean;
  readonly held: number;
  readonly lastError: TransportErrorKind | null;
  readonly syncing: boolean;
  readonly lastSyncedAt: number | null;
}

export function deriveStatus(input: StatusInput): SyncStatus {
  const { counts, online, held, lastError, syncing, lastSyncedAt } = input;
  let state: SyncState;
  if (!online || lastError === 'offline') {
    state = 'offline';
  } else if (counts.failed > 0 || held > 0 || lastError === 'protocol' || lastError === 'auth') {
    state = 'error';
  } else if (counts.pending > 0 || lastError !== null) {
    state = 'pending';
  } else {
    state = 'synced';
  }
  return {
    state,
    syncing,
    pending: counts.pending,
    failed: counts.failed,
    conflicts: counts.conflicts,
    lost: counts.lost,
    held,
    lastError,
    lastSyncedAt,
  };
}

export function sameStatus(a: SyncStatus, b: SyncStatus): boolean {
  return (
    a.state === b.state &&
    a.syncing === b.syncing &&
    a.pending === b.pending &&
    a.failed === b.failed &&
    a.conflicts === b.conflicts &&
    a.lost === b.lost &&
    a.held === b.held &&
    a.lastError === b.lastError &&
    a.lastSyncedAt === b.lastSyncedAt
  );
}

/** Esperas entre reintentos tras un fallo, en ms: 5 s, 15 s, 45 s, 2 min y 5 min. */
export const BACKOFF_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000, 300_000];

const MAX_BACKOFF_MS = 300_000;
const JITTER = 0.2;

/**
 * Espera antes del reintento número `attempt` (desde 1): la tabla de `BACKOFF_MS`, que se queda
 * en 5 min, con una variación de ±20 % para que varios teléfonos no vuelvan al mismo tiempo.
 * `random` devuelve un número en [0, 1).
 */
export function nextBackoff(attempt: number, random: () => number): number {
  const index = Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1;
  const factor = 1 + (random() * 2 - 1) * JITTER;
  return Math.round((BACKOFF_MS[index] ?? MAX_BACKOFF_MS) * factor);
}
