import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';

const MAX_NAME_LENGTH = 80;

/** Lo que va a `profiles`: el nombre ya resuelto, el de la cuenta o el de respaldo ("Usuario"). */
export interface RemoteProfile {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * Nombre del perfil, recortado a 80 caracteres sin partir un emoji. Nunca sale del correo: los
 * demás miembros del grupo ven los perfiles.
 */
export function profileName(displayName: string): string {
  return Array.from(displayName.trim()).slice(0, MAX_NAME_LENGTH).join('');
}

/**
 * Asegura la fila de `profiles` de la cuenta: la crea si falta y no toca una que ya exista
 * (`INSERT ... ON CONFLICT DO NOTHING`). Nunca lanza: sin red o con un rechazo, queda pendiente
 * y la app lo vuelve a intentar en el siguiente arranque. Nada local depende del perfil remoto.
 */
export async function ensureRemoteProfile(
  client: SupabaseClient,
  profile: RemoteProfile,
): Promise<'synced' | 'pending'> {
  try {
    const { error } = await client
      .from('profiles')
      .upsert(
        { id: profile.userId, display_name: profileName(profile.displayName) },
        { onConflict: 'id', ignoreDuplicates: true },
      );
    if (error) {
      logger.warn('No se pudo asegurar el perfil remoto; se reintenta al volver a abrir la app', {
        code: error.code,
      });
      return 'pending';
    }
    return 'synced';
  } catch {
    logger.warn('Sin conexión para asegurar el perfil remoto; se reintenta al volver a abrir');
    return 'pending';
  }
}
