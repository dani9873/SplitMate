import { z } from 'zod';

/** Valores públicos del proyecto de Supabase. La clave secreta nunca llega a la app. */
export interface SupabaseEnv {
  readonly url: string;
  readonly publishableKey: string;
}

/** Faltan variables o no tienen el formato esperado. El mensaje nombra las variables, nunca sus valores. */
export class SupabaseConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`Configuración de Supabase inválida o ausente: ${variables.join(', ')}`);
    this.name = 'SupabaseConfigError';
  }
}

const VARIABLES = {
  url: 'EXPO_PUBLIC_SUPABASE_URL',
  publishableKey: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
} as const;

/** `https://<ref>.supabase.co`, sin ruta, consulta ni credenciales. */
const PROJECT_URL = /^https:\/\/[a-z0-9-]{1,63}\.supabase\.co$/;
/** Solo la clave publicable: una `sb_secret_` o un JWT legacy se rechazan. */
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/;

const envSchema = z.object({
  url: z.string().regex(PROJECT_URL),
  publishableKey: z.string().regex(PUBLISHABLE_KEY),
});

export function parseSupabaseEnv(raw: { url?: string; publishableKey?: string }): SupabaseEnv {
  const result = envSchema.safeParse({
    url: raw.url?.endsWith('/') ? raw.url.slice(0, -1) : raw.url,
    publishableKey: raw.publishableKey,
  });
  if (!result.success) {
    const invalid = new Set(result.error.issues.map((issue) => issue.path[0]));
    throw new SupabaseConfigError(
      (['url', 'publishableKey'] as const)
        .filter((field) => invalid.has(field))
        .map((field) => VARIABLES[field]),
    );
  }
  return result.data;
}

/**
 * Lee las variables del `.env`. Expo las incrusta en el bundle solo si se leen con acceso literal
 * a `process.env.EXPO_PUBLIC_*`, como aquí.
 */
export function readSupabaseEnv(): SupabaseEnv {
  return parseSupabaseEnv({
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
