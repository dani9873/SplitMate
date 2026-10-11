import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import type { AuthService, AuthSession } from './auth-service';

export type AuthState =
  | { readonly status: 'restoring' }
  | { readonly status: 'signedOut' }
  | { readonly status: 'signedIn'; readonly session: AuthSession };

interface AuthContextValue {
  readonly state: AuthState;
  readonly service: AuthService;
  /** Pasa a la sesión que devolvió el servicio: entrar, código o enlace del correo. */
  signIn(session: AuthSession): void;
  /** Cierra la sesión de este teléfono. */
  signOut(): Promise<void>;
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
      (session) => settle(session ? { status: 'signedIn', session } : { status: 'signedOut' }),
      () => settle({ status: 'signedOut' }),
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [service]);

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
    (session: AuthSession) => setState({ status: 'signedIn', session }),
    [],
  );
  const signOut = useCallback(async () => {
    await service.signOut();
    setState({ status: 'signedOut' });
  }, [service]);

  const value = useMemo(
    () => ({ state, service, signIn, signOut }),
    [state, service, signIn, signOut],
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
