import { getSupabase } from '@/lib/supabase/client';

import { createSupabaseAuthService, type AuthService } from './auth-service';

let service: AuthService | null = null;

/** El servicio de auth de la app. Lanza `SupabaseConfigError` si falta la configuración. */
export function getAppAuthService(): AuthService {
  if (!service) {
    const { client, storage } = getSupabase();
    service = createSupabaseAuthService(client, storage);
  }
  return service;
}
