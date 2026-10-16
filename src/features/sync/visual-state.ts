import type { SyncState, SyncStatus } from './status';

export type VisualState = SyncState | 'syncing';

/** Lo que se dibuja: un ciclo en curso se ve como "sincronizando" sin importar el estado. */
export function visualState(status: Pick<SyncStatus, 'state' | 'syncing'>): VisualState {
  return status.syncing ? 'syncing' : status.state;
}
