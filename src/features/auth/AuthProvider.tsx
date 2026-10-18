import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import {
  clearPendingInvite,
  purgeExpiredPendingInvite,
} from '@/features/invitations/pending-invite';
import { logger } from '@/lib/logger';

import type { AuthService, AuthSession } from './auth-service';

export type AuthState =
  | { readonly status: 'restoring' }
  | { readonly status: 'signedOut' }
  | {
      readonly status: 'signedIn';
      readonly session: AuthSession;
      /** Entró con un correo de recuperación: falta elegir la contraseña nueva. */
      readonly recovering: boolean;
    };

interface AuthContextValue {
  readonly state: AuthState;
  readonly service: AuthService;
  /** Pasa a la sesión que devolvió el servicio: entrar, código o enlace del correo. */
  signIn(session: AuthSession, options?: { recovery?: boolean }): void;
  /** Ya eligió la contraseña nueva: sigue a la app. */
  finishRecovery(): void;
  /**
   * Cierra la sesión de este teléfono. `cleanup` corre cuando las pantallas con sesión ya se
   * desmontaron (y su base se cerró): por ejemplo, borrar los datos de la cuenta.
   */
  signOut(options?: { cleanup?: () => Promise<void> }): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Estado de la sesión de la app. Al arrancar lo toma de la sesión guardada, sin red; después
 * solo sale si el usuario cierra la sesión o Supabase la rechaza de forma definitiva. Con sesión,
 * renueva el token en primer plano y lo pausa en segundo plano.
 */
export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'restoring' });

  useEffect(() => {
    let mounted = true;
    const unsubscribe = service.onSignedOut(() => setState({ status: 'signedOut' }));
    // Solo cuenta si nada cambió mientras tanto: un cierre de Supabase gana a lo restaurado.
    const settle = (next: AuthState) =>
      mounted && setState((current) => (current.status === 'restoring' ? next : current));
    service.restore().then(
      (session) =>
        settle(
          session ? { status: 'signedIn', session, recovering: false } : { status: 'signedOut' },
        ),
      () => settle({ status: 'signedOut' }),
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [service]);

  // Un enlace de invitación pendiente es de quien lo recibió: no sobrevive a la sesión que lo vio.
  // Al abrir la app se borra el que ya venció; al cerrar sesión o pasar a otra cuenta, el que haya.
  // Entrar desde sin sesión lo conserva: es el caso de quien se registra con un enlace.
  useEffect(() => {
    void purgeExpiredPendingInvite();
  }, []);
  const userId = state.status === 'signedIn' ? state.session.userId : null;
  const lastUserId = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastUserId.current;
    lastUserId.current = userId;
    if (previous !== null && previous !== userId) {
      void clearPendingInvite();
    }
  }, [userId]);

  const signedIn = state.status === 'signedIn';
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    service.setAutoRefresh(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (next) =>
      service.setAutoRefresh(next === 'active'),
    );
    return () => {
      subscription.remove();
      service.setAutoRefresh(false);
    };
  }, [service, signedIn]);

  const signIn = useCallback(
    (session: AuthSession, options?: { recovery?: boolean }) =>
      setState({ status: 'signedIn', session, recovering: options?.recovery ?? false }),
    [],
  );
  const finishRecovery = useCallback(
    () =>
      setState((current) =>
        current.status === 'signedIn' ? { ...current, recovering: false } : current,
      ),
    [],
  );
  // Limpieza pendiente para después de desmontar las pantallas con sesión. El contador hace que
  // corra aunque la sesión ya estuviera cerrada (el estado no cambia).
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);
  const [cleanupRequests, setCleanupRequests] = useState(0);
  useEffect(() => {
    const cleanup = cleanupRef.current;
    if (state.status !== 'signedOut' || !cleanup) {
      return;
    }
    cleanupRef.current = null;
    cleanup().catch((error: unknown) =>
      logger.warn('Falló la limpieza al cerrar la sesión', error),
    );
  }, [state.status, cleanupRequests]);

  const signOut = useCallback(
    async (options?: { cleanup?: () => Promise<void> }) => {
      await service.signOut();
      const cleanup = options?.cleanup;
      if (!cleanup) {
        setState({ status: 'signedOut' });
        return;
      }
      // Termina cuando terminó la limpieza, que corre después de desmontar.
      await new Promise<void>((resolve, reject) => {
        cleanupRef.current = () => cleanup().then(resolve, reject);
        setState({ status: 'signedOut' });
        setCleanupRequests((count) => count + 1);
      });
    },
    [service],
  );

  const value = useMemo(
    () => ({ state, service, signIn, finishRecovery, signOut }),
    [state, service, signIn, finishRecovery, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth necesita un AuthProvider');
  }
  return value;
}
