import type { SyncNotice } from '@/db/sync';

import type { SyncEngine } from './engine';
import type { SyncStatus } from './status';

export const SYNCED_STATUS: SyncStatus = {
  state: 'synced',
  syncing: false,
  pending: 0,
  failed: 0,
  conflicts: 0,
  lost: 0,
  held: 0,
  lastError: null,
  lastSyncedAt: null,
};

export type FakeSyncEngine = { [K in keyof SyncEngine]: jest.Mock } & {
  /** Cambia el estado y avisa a quienes lo observan, como haría el motor real. */
  setStatus(patch: Partial<SyncStatus>): void;
  /** Entrega un aviso de conflicto a quienes escuchan `onNotice`, como el motor tras un ciclo. */
  emitNotice(notice: SyncNotice): void;
};

/** Motor falso para probar la interfaz: el estado se cambia a mano y las acciones se espían. */
export function createFakeSyncEngine(initial: Partial<SyncStatus> = {}): FakeSyncEngine {
  let status: SyncStatus = { ...SYNCED_STATUS, ...initial };
  const listeners = new Set<() => void>();
  const noticeListeners = new Set<(notice: SyncNotice) => void>();
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
    onNotice: jest.fn((listener: (notice: SyncNotice) => void) => {
      noticeListeners.add(listener);
      return () => {
        noticeListeners.delete(listener);
      };
    }),
    setStatus(patch) {
      status = { ...status, ...patch };
      listeners.forEach((listener) => listener());
    },
    emitNotice(notice) {
      [...noticeListeners].forEach((listener) => listener(notice));
    },
  };
}
