import { appRepositoryDeps } from '@/db/app-deps';
import type { ChangeBus } from '@/db/changes';
import type { AppDatabase } from '@/db/repositories';
import { createSyncRemote, createSyncStore } from '@/db/sync';
import { getSupabase } from '@/lib/supabase/client';
import { createSupabaseRpc } from '@/lib/supabase/rpc';

import { createSyncEngine, type Scheduler, type SyncEngine } from './engine';
import { createNetworkMonitor } from './network';

export interface AppSyncEngineDeps {
  readonly db: AppDatabase;
  readonly bus: ChangeBus;
  readonly ensureProfile: () => Promise<'synced' | 'pending'>;
}

const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** El motor de la app: la base y el bus de la cuenta, el cliente de Supabase y la red del sistema. */
export function createAppSyncEngine({ db, bus, ensureProfile }: AppSyncEngineDeps): SyncEngine {
  const { client } = getSupabase();
  return createSyncEngine({
    store: createSyncStore(db, bus, appRepositoryDeps),
    remote: createSyncRemote(createSupabaseRpc(client)),
    changes: bus,
    network: createNetworkMonitor(),
    ensureProfile,
    scheduler: realScheduler,
    random: Math.random,
  });
}
