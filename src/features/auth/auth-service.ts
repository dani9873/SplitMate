import {
  FunctionsFetchError,
  FunctionsHttpError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { z } from 'zod';

import { logger } from '@/lib/logger';
import { SESSION_STORAGE_KEY } from '@/lib/supabase/create-client';
import type { SupportedStorage } from '@/lib/supabase/session-storage';

import { AuthError, isExistingAccountError, toAuthError } from './auth-errors';
import { ensureRemoteProfile, type RemoteProfile } from './profile-sync';

/** Destino de los enlaces de los correos. Es la única redirección permitida en Supabase. */
export const AUTH_REDIRECT_URL = 'splitmate://auth/callback';

/**
 * Los correos traen el código de 6 dígitos solo con las plantillas propias de
 * `supabase/templates`, y el panel de Supabase pide SMTP propio para editarlas. Con las
 * predeterminadas llega solo el enlace. Pasar a `true` al configurar SMTP y pegar las plantillas
 * (pendiente en CLAUDE.md).
 */
export const EMAIL_HAS_CODE = false;

/** Último correo pedido en este teléfono, en el almacenamiento cifrado de la sesión. */
export const EMAIL_FLOW_STORAGE_KEY = 'splitmate-email-flow';

/** Lo que la app sabe de la cuenta con sesión. */
export interface AuthSession {
  readonly userId: string;
  readonly email: string;
  /** Nombre del registro, si la cuenta lo tiene. */
  readonly displayName: string | null;
}

/** Para qué se envió un correo: confirmar el registro o recuperar la contraseña. */
export type EmailFlow = 'signup' | 'recovery';

/** El último correo que se pidió desde este teléfono y que todavía no abrió una sesión. */
export interface PendingEmailFlow {
  readonly flow: EmailFlow;
  readonly email: string;
}

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
  /**
   * Canjea el código del enlace del correo. `recovery`: el enlace era de recuperación. Supabase
   * solo lo acepta hasta 5 minutos después de pedir el correo, aunque el enlace ya haya confirmado
   * el correo: después lanza `linkExpired`.
   */
  exchangeCode(
    code: string,
    flowId: string | null,
  ): Promise<{ session: AuthSession; recovery: boolean }>;
  /**
   * Para qué fue el último correo pedido en este teléfono, si todavía no se entró. Explica qué
   * hacer cuando un enlace no abre la sesión.
   */
  pendingEmailFlow(): Promise<PendingEmailFlow | null>;
  /** Los correos traen el código de 6 dígitos además del enlace. */
  emailHasCode(): boolean;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Cierra la sesión de este teléfono. Sin red, igual la borra del teléfono. */
  signOut(): Promise<void>;
  /** Renovación automática del token: activa en primer plano, pausada en segundo plano. */
  setAutoRefresh(active: boolean): void;
  /** Supabase cerró la sesión: la cerró el usuario o el servidor la rechazó de forma definitiva. */
  onSignedOut(listener: () => void): () => void;
  /**
   * Crea el perfil remoto si falta, con el nombre ya resuelto (el de la cuenta o el de respaldo).
   * Nunca lanza: sin red, se reintenta en el próximo arranque.
   */
  ensureProfile(profile: RemoteProfile): Promise<void>;
  /**
   * Vuelve a pedir la contraseña: una sesión nueva y reciente para borrar la cuenta. Si el correo
   * ya es de otra cuenta, cierra la sesión de este teléfono y lanza `sessionExpired`.
   */
  reauthenticateWithPassword(session: AuthSession, password: string): Promise<void>;
  /** Borra la cuenta en Supabase (Edge Function `delete-account`). Pide una sesión reciente. */
  deleteAccount(): Promise<void>;
}

const userSchema = z.object({
  id: z.uuid(),
  email: z.string().min(1).max(254),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});

const storedSessionSchema = z.object({ user: userSchema });

const pendingEmailFlowSchema = z.object({
  flow: z.enum(['signup', 'recovery']),
  email: z.email().max(254),
});

/** Valida el usuario que llega de Supabase o del teléfono y lo resume como `AuthSession`. */
function toAuthSession(raw: unknown): AuthSession {
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthError('unknown', 'Supabase devolvió un usuario con forma inesperada');
  }
  const user = parsed.data;
  const name = user.user_metadata?.display_name;
  return {
    userId: user.id,
    email: user.email,
    displayName: typeof name === 'string' && name.trim().length > 0 ? name.trim() : null,
  };
}

export function createSupabaseAuthService(
  client: SupabaseClient,
  storage: SupportedStorage,
  { emailHasCode = EMAIL_HAS_CODE }: { emailHasCode?: boolean } = {},
): AuthService {
  const auth = client.auth;

  async function signOutHere(): Promise<void> {
    const { error } = await auth.signOut({ scope: 'local' });
    if (error) {
      // Sin red, supabase-js no borra la sesión. Se borra igual: la revocación en el servidor se
      // pierde, pero el refresh token ya no queda en el teléfono.
      await storage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  /**
   * Recuerda (o, sin flujo, olvida) el último correo pedido. Solo ajusta los mensajes de la app:
   * si el almacenamiento falla, el resto sigue igual.
   */
  async function rememberEmailFlow(pending: PendingEmailFlow | null): Promise<void> {
    try {
      await (pending
        ? storage.setItem(EMAIL_FLOW_STORAGE_KEY, JSON.stringify(pending))
        : storage.removeItem(EMAIL_FLOW_STORAGE_KEY));
    } catch {
      logger.warn('No se pudo guardar el último correo pedido');
    }
  }

  async function requestPasswordReset(email: string): Promise<void> {
    const { error } = await auth.resetPasswordForEmail(email, { redirectTo: AUTH_REDIRECT_URL });
    if (error) {
      throw toAuthError(error);
    }
    await rememberEmailFlow({ flow: 'recovery', email });
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
      await rememberEmailFlow({ flow: 'signup', email });
    },

    async signIn(email, password) {
      const { data, error } = await auth.signInWithPassword({ email, password });
      if (error) {
        throw toAuthError(error);
      }
      await rememberEmailFlow(null);
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
      await rememberEmailFlow(null);
      return toAuthSession(data.user);
    },

    async resend(email, flow) {
      if (flow === 'recovery') {
        return requestPasswordReset(email);
      }
      // Con PKCE, como el registro: el enlace reenviado vuelve con `?code=`.
      const { error } = await auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: AUTH_REDIRECT_URL },
      });
      if (error) {
        throw toAuthError(error);
      }
      await rememberEmailFlow({ flow: 'signup', email });
    },

    async exchangeCode(code, flowId) {
      const { data, error } = await auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      if (error) {
        throw toAuthError(error);
      }
      await rememberEmailFlow(null);
      // auth-js agrega `redirectType` a la respuesta aunque su tipo público no lo declara.
      const { redirectType } = data as { redirectType?: string | null };
      return { session: toAuthSession(data.user), recovery: redirectType === 'recovery' };
    },

    async pendingEmailFlow() {
      const raw = await storage.getItem(EMAIL_FLOW_STORAGE_KEY).catch(() => null);
      if (raw === null) {
        return null;
      }
      try {
        return pendingEmailFlowSchema.parse(JSON.parse(raw));
      } catch {
        return null;
      }
    },

    emailHasCode: () => emailHasCode,

    requestPasswordReset,

    async updatePassword(password) {
      const { error } = await auth.updateUser({ password });
      if (error) {
        throw toAuthError(error);
      }
    },

    signOut: signOutHere,

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

    async ensureProfile(profile) {
      await ensureRemoteProfile(client, profile);
    },

    async reauthenticateWithPassword(session, password) {
      const { data, error } = await auth.signInWithPassword({ email: session.email, password });
      if (error) {
        throw toAuthError(error);
      }
      // El correo es de una sola cuenta: si entró otra, la de esta sesión ya no existe. Nada se
      // borra, y la sesión nueva no se queda en el teléfono.
      if (data.user.id !== session.userId) {
        await signOutHere();
        throw new AuthError('sessionExpired');
      }
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
