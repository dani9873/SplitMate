import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { SupabaseEnv } from './env';
import type { SupportedStorage } from './session-storage';

/** Nombre fijo de la sesión en el almacenamiento: la app la lee sin red al arrancar. */
export const SESSION_STORAGE_KEY = 'splitmate-auth';

interface ClientDeps {
  env: SupabaseEnv;
  storage: SupportedStorage;
  /** Solo para pruebas: un servidor falso. */
  fetch?: typeof fetch;
}

/**
 * Cliente de Supabase de la app. PKCE para los enlaces del correo; la sesión se guarda con el
 * almacenamiento que se le pase (cifrado en la app) y la URL no se revisa: los enlaces entran
 * por la ruta `auth/callback`, que los valida.
 */
export function createSupabaseClient({ env, storage, fetch }: ClientDeps): SupabaseClient {
  return createClient(env.url, env.publishableKey, {
    auth: {
      storage,
      storageKey: SESSION_STORAGE_KEY,
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    ...(fetch ? { global: { fetch } } : {}),
  });
}
