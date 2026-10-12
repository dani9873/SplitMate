// Entrada Deno de la Edge Function `delete-account`. La lógica vive en handler.ts, probada con
// Jest; aquí solo se crean el cliente de administración y el servidor.
//
// La clave secreta la pone Supabase en el entorno de la función: nunca está en el repo ni en la
// app. Con las claves nuevas llega en SUPABASE_SECRET_KEYS (JSON por nombre); con las legacy, en
// SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

import { createDeleteAccountHandler } from './handler.ts';

function readSecretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) {
      return parsed.default;
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) {
    throw new Error('Falta la clave secreta de Supabase en el entorno de la función');
  }
  return legacy;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, readSecretKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(
  createDeleteAccountHandler({
    async getUser(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    async deleteUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        throw error;
      }
    },
    now: () => Date.now(),
    log: (message, error) => console.error(message, error),
  }),
);
