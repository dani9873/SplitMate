import { getSupabase } from '@/lib/supabase/client';
import { SupabaseConfigError } from '@/lib/supabase/env';

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

/** El servicio, o el error de configuración para mostrarlo en lugar de cerrar la app. */
export function loadAppAuthService(): { service: AuthService } | { error: SupabaseConfigError } {
  try {
    return { service: getAppAuthService() };
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return { error };
    }
    throw error;
  }
}
