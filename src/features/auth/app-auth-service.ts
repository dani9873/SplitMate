import { requireOptionalNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';

import { getSupabase } from '@/lib/supabase/client';
import { SupabaseConfigError, readGoogleWebClientId } from '@/lib/supabase/env';

import { createSupabaseAuthService, type AuthService } from './auth-service';
import type { GoogleAuthModule } from './google';

let service: AuthService | null = null;

/** El servicio de auth de la app. Lanza `SupabaseConfigError` si falta la configuración. */
export function getAppAuthService(): AuthService {
  if (!service) {
    const { client, storage } = getSupabase();
    service = createSupabaseAuthService(client, storage, {
      // Solo existe en Android con un build propio: en iOS y Expo Go no hay botón de Google.
      module: requireOptionalNativeModule<GoogleAuthModule>('SplitmateGoogleAuth'),
      webClientId: readGoogleWebClientId(),
      randomBytes: (length) => Crypto.getRandomBytes(length),
      sha256Hex: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
    });
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
