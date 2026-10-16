import type { SyncEngine } from './engine';
import type { SyncStatus } from './status';

export const SYNCED_STATUS: SyncStatus = {
  state: 'synced',
  syncing: false,
  pending: 0,
  failed: 0,
  conflicts: 0,
  held: 0,
  lastError: null,
  lastSyncedAt: null,
};

export type FakeSyncEngine = { [K in keyof SyncEngine]: jest.Mock } & {
  /** Cambia el estado y avisa a quienes lo observan, como haría el motor real. */
  setStatus(patch: Partial<SyncStatus>): void;
};

/** Motor falso para probar la interfaz: el estado se cambia a mano y las acciones se espían. */
export function createFakeSyncEngine(initial: Partial<SyncStatus> = {}): FakeSyncEngine {
  let status: SyncStatus = { ...SYNCED_STATUS, ...initial };
  const listeners = new Set<() => void>();
  return {
    start: jest.fn(),
    stop: jest.fn(),
    request: jest.fn(),
    syncNow: jest.fn(async () => status),
    retryFailed: jest.fn(),
    getStatus: jest.fn(() => status),
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    onNotice: jest.fn(() => () => undefined),
    setStatus(patch) {
      status = { ...status, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
}
