import {
  FunctionsFetchError,
  FunctionsHttpError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { z } from 'zod';

import { SESSION_STORAGE_KEY } from '@/lib/supabase/create-client';
import type { SupportedStorage } from '@/lib/supabase/session-storage';

import { AuthError, isExistingAccountError, toAuthError } from './auth-errors';
import { isGoogleSignInAvailable, requestGoogleIdToken, type GoogleSignInDeps } from './google';
import { ensureRemoteProfile } from './profile-sync';

/** Destino de los enlaces de los correos. Es la única redirección permitida en Supabase. */
export const AUTH_REDIRECT_URL = 'splitmate://auth/callback';

/** Lo que la app sabe de la cuenta con sesión. */
export interface AuthSession {
  readonly userId: string;
  readonly email: string;
  /** Formas de entrar de la cuenta: `email`, `google`. */
  readonly providers: readonly string[];
  /** Nombre del registro o de Google, si hay. */
  readonly displayName: string | null;
}

/** Para qué se envió un correo: confirmar el registro o recuperar la contraseña. */
export type EmailFlow = 'signup' | 'recovery';

export interface SignUpInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  /** Idioma de la app: elige el texto de los correos. */
  readonly locale: string;
}

/**
 * Operaciones de cuenta de la app. Las pantallas y el proveedor usan esta interfaz; las
 * pruebas de pantallas, una versión falsa. Los errores siempre son `AuthError`.
 */
export interface AuthService {
  /** La sesión guardada en el teléfono, sin red. */
  restore(): Promise<AuthSession | null>;
  signUp(input: SignUpInput): Promise<void>;
  signIn(email: string, password: string): Promise<AuthSession>;
  verifyCode(email: string, code: string, flow: EmailFlow): Promise<AuthSession>;
  resend(email: string, flow: EmailFlow): Promise<void>;
  /** Canjea el código del enlace del correo. `recovery`: el enlace era de recuperación. */
  exchangeCode(
    code: string,
    flowId: string | null,
  ): Promise<{ session: AuthSession; recovery: boolean }>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Cierra la sesión de este teléfono. Sin red, igual la borra del teléfono. */
  signOut(): Promise<void>;
  /** Renovación automática del token: activa en primer plano, pausada en segundo plano. */
  setAutoRefresh(active: boolean): void;
  /** Supabase cerró la sesión: la cerró el usuario o el servidor la rechazó de forma definitiva. */
  onSignedOut(listener: () => void): () => void;
  /** Crea el perfil remoto si falta. Nunca lanza: sin red, se reintenta en el próximo arranque. */
  ensureProfile(session: AuthSession): Promise<void>;
  /** Hay módulo de Google (Android) y cliente web configurado. */
  canUseGoogle(): boolean;
  /** Entra con Google. `null` si el usuario cerró la hoja de Google. */
  signInWithGoogle(): Promise<AuthSession | null>;
  /** Vuelve a pedir la contraseña: una sesión nueva y reciente para borrar la cuenta. */
  reauthenticateWithPassword(email: string, password: string): Promise<void>;
  /** Vuelve a elegir la cuenta de Google. `false` si el usuario cerró la hoja. */
  reauthenticateWithGoogle(): Promise<boolean>;
  /** Borra la cuenta en Supabase (Edge Function `delete-account`). Pide una sesión reciente. */
  deleteAccount(): Promise<void>;
}

const userSchema = z.object({
  id: z.uuid(),
  email: z.string().min(1).max(254),
  app_metadata: z
    .object({
      provider: z.string().optional(),
      providers: z.array(z.string()).optional(),
    })
    .optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});

const storedSessionSchema = z.object({ user: userSchema });

/** Valida el usuario que llega de Supabase o del teléfono y lo resume como `AuthSession`. */
function toAuthSession(raw: unknown): AuthSession {
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthError('unknown', 'Supabase devolvió un usuario con forma inesperada');
  }
  const user = parsed.data;
  const metadata = user.user_metadata ?? {};
  const name = [metadata.display_name, metadata.full_name, metadata.name].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  const provider = user.app_metadata?.provider;
  return {
    userId: user.id,
    email: user.email,
    providers: user.app_metadata?.providers ?? (provider ? [provider] : []),
    displayName: name?.trim() ?? null,
  };
}

const NO_GOOGLE: GoogleSignInDeps = {
  module: null,
  webClientId: null,
  randomBytes: () => new Uint8Array(),
  sha256Hex: async () => '',
};

export function createSupabaseAuthService(
  client: SupabaseClient,
  storage: SupportedStorage,
  google: GoogleSignInDeps = NO_GOOGLE,
): AuthService {
  const auth = client.auth;

  async function signInWithGoogle(): Promise<AuthSession | null> {
    const token = await requestGoogleIdToken(google);
    if (!token) {
      return null;
    }
    const { data, error } = await auth.signInWithIdToken({
      provider: 'google',
      token: token.idToken,
      nonce: token.nonce,
    });
    if (error) {
      throw toAuthError(error);
    }
    return toAuthSession(data.user);
  }

  async function requestPasswordReset(email: string): Promise<void> {
    const { error } = await auth.resetPasswordForEmail(email, { redirectTo: AUTH_REDIRECT_URL });
    if (error) {
      throw toAuthError(error);
    }
  }

  return {
    async restore() {
      const raw = await storage.getItem(SESSION_STORAGE_KEY);
      if (raw === null) {
        return null;
      }
      try {
        return toAuthSession(storedSessionSchema.parse(JSON.parse(raw)).user);
      } catch {
        return null;
      }
    },

    async signUp({ email, password, displayName, locale }) {
      const { error } = await auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: AUTH_REDIRECT_URL,
          data: { display_name: displayName, locale },
        },
      });
      // Un correo ya registrado sigue el mismo camino: "revisa tu correo".
      if (error && !isExistingAccountError(error)) {
        throw toAuthError(error);
      }
    },

    async signIn(email, password) {
      const { data, error } = await auth.signInWithPassword({ email, password });
      if (error) {
        throw toAuthError(error);
      }
      return toAuthSession(data.user);
    },

    async verifyCode(email, code, flow) {
      const { data, error } = await auth.verifyOtp({ email, token: code, type: flow });
      if (error) {
        throw toAuthError(error);
      }
      if (!data.session) {
        throw new AuthError('invalidCode');
      }
      return toAuthSession(data.user);
    },

    async resend(email, flow) {
      if (flow === 'recovery') {
        return requestPasswordReset(email);
      }
      const { error } = await auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: AUTH_REDIRECT_URL },
      });
      if (error) {
        throw toAuthError(error);
      }
    },

    async exchangeCode(code, flowId) {
      const { data, error } = await auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      if (error) {
        throw toAuthError(error);
      }
      // auth-js agrega `redirectType` a la respuesta aunque su tipo público no lo declara.
      const { redirectType } = data as { redirectType?: string | null };
      return { session: toAuthSession(data.user), recovery: redirectType === 'recovery' };
    },

    requestPasswordReset,

    async updatePassword(password) {
      const { error } = await auth.updateUser({ password });
      if (error) {
        throw toAuthError(error);
      }
    },

    async signOut() {
      const { error } = await auth.signOut({ scope: 'local' });
      if (error) {
        // Sin red, supabase-js no borra la sesión. Se borra igual: la revocación en el servidor se
        // pierde, pero el refresh token ya no queda en el teléfono.
        await storage.removeItem(SESSION_STORAGE_KEY);
      }
    },

    setAutoRefresh(active) {
      void (active ? auth.startAutoRefresh() : auth.stopAutoRefresh());
    },

    onSignedOut(listener) {
      const { data } = auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          listener();
        }
      });
      return () => data.subscription.unsubscribe();
    },

    async ensureProfile(session) {
      await ensureRemoteProfile(client, session);
    },

    canUseGoogle: () => isGoogleSignInAvailable(google),

    signInWithGoogle,

    async reauthenticateWithPassword(email, password) {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) {
        throw toAuthError(error);
      }
    },

    async reauthenticateWithGoogle() {
      return (await signInWithGoogle()) !== null;
    },

    async deleteAccount() {
      const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
      if (!error) {
        return;
      }
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response;
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        if (response.status === 403 && body?.error === 'reauthentication_required') {
          throw new AuthError('reauthenticationRequired');
        }
        throw new AuthError(response.status === 401 ? 'sessionExpired' : 'unavailable');
      }
      throw new AuthError(error instanceof FunctionsFetchError ? 'offline' : 'unknown');
    },
  };
}
