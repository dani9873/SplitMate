import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';

import type { AuthSession } from './auth-service';

const MAX_NAME_LENGTH = 80;

/** Nombre del perfil: el del registro o de Google; si no hay, la parte del correo antes de @. */
export function profileName(session: AuthSession): string {
  const name = session.displayName?.trim() || session.email.split('@')[0] || session.email;
  return Array.from(name).slice(0, MAX_NAME_LENGTH).join('');
}

/**
 * Asegura la fila de `profiles` de la cuenta: la crea si falta y no toca una que ya exista
 * (`INSERT ... ON CONFLICT DO NOTHING`). Nunca lanza: sin red o con un rechazo, queda pendiente
 * y la app lo vuelve a intentar en el siguiente arranque. Nada local depende del perfil remoto.
 */
export async function ensureRemoteProfile(
  client: SupabaseClient,
  session: AuthSession,
): Promise<'synced' | 'pending'> {
  try {
    const { error } = await client
      .from('profiles')
      .upsert(
        { id: session.userId, display_name: profileName(session) },
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
