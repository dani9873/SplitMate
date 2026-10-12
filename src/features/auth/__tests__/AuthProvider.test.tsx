import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';

import type { AuthSession } from '../auth-service';
import { AuthProvider, useAuth } from '../AuthProvider';
import { TEST_SESSION, createFakeAuthService, type FakeAuthService } from '../test-utils';

function Status() {
  const { state } = useAuth();
  return (
    <Text testID="status">
      {state.status === 'signedIn' ? `signedIn:${state.session.email}` : state.status}
    </Text>
  );
}

let auth: ReturnType<typeof useAuth> | null = null;
function Capture({ onAuth }: { onAuth: (value: ReturnType<typeof useAuth>) => void }) {
  const value = useAuth();
  useEffect(() => onAuth(value), [onAuth, value]);
  return null;
}
const capture = (value: ReturnType<typeof useAuth>) => {
  auth = value;
};

async function renderProvider(service: FakeAuthService) {
  await render(
    <AuthProvider service={service}>
      <Status />
      <Capture onAuth={capture} />
    </AuthProvider>,
  );
}

const status = () => screen.getByTestId('status').props.children as string;

/** restore() que se resuelve cuando la prueba quiere. */
function pendingRestore() {
  let finish: (session: AuthSession | null) => void = () => {};
  const restore = () => new Promise<AuthSession | null>((resolve) => (finish = resolve));
  return { restore, finish: (session: AuthSession | null) => finish(session) };
}

describe('AuthProvider', () => {
  let appStateHandler: ((state: AppStateStatus) => void) | null;
  const removeAppStateListener = jest.fn();
  // En el mock de React Native para Jest, currentState no es un texto: se fija a mano.
  const originalCurrentState = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;

  beforeEach(() => {
    auth = null;
    appStateHandler = null;
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handler) => {
      appStateHandler = handler as (state: AppStateStatus) => void;
      return { remove: removeAppStateListener };
    });
  });

  afterEach(() => {
    Object.defineProperty(AppState, 'currentState', originalCurrentState);
    jest.restoreAllMocks();
    removeAppStateListener.mockClear();
  });

  it('empieza restaurando y entra con la sesión guardada', async () => {
    const pending = pendingRestore();
    await renderProvider(createFakeAuthService({ restore: pending.restore }));
    expect(status()).toBe('restoring');

    await act(async () => pending.finish(TEST_SESSION));
    expect(status()).toBe('signedIn:ana@example.com');
  });

  it('sin sesión guardada queda sin sesión', async () => {
    await renderProvider(createFakeAuthService());
    await waitFor(() => expect(status()).toBe('signedOut'));
  });

  it('si restaurar falla, queda sin sesión en lugar de colgarse', async () => {
    const service = createFakeAuthService({
      restore: async () => {
        throw new Error('almacenamiento roto');
      },
    });
    await renderProvider(service);
    await waitFor(() => expect(status()).toBe('signedOut'));
  });

  it('cuando Supabase cierra la sesión, sale', async () => {
    const service = createFakeAuthService({ restore: async () => TEST_SESSION });
    await renderProvider(service);
    await waitFor(() => expect(status()).toBe('signedIn:ana@example.com'));

    await act(async () => service.emitSignedOut());
    expect(status()).toBe('signedOut');
  });

  it('un cierre de Supabase durante la restauración gana a la sesión restaurada', async () => {
    const pending = pendingRestore();
    const service = createFakeAuthService({ restore: pending.restore });
    await renderProvider(service);

    await act(async () => service.emitSignedOut());
    await act(async () => pending.finish(TEST_SESSION));
    expect(status()).toBe('signedOut');
  });

  it('renueva el token solo en primer plano', async () => {
    const service = createFakeAuthService({ restore: async () => TEST_SESSION });
    await renderProvider(service);
    await waitFor(() => expect(service.setAutoRefresh).toHaveBeenLastCalledWith(true));

    await act(async () => appStateHandler!('background'));
    expect(service.setAutoRefresh).toHaveBeenLastCalledWith(false);
    await act(async () => appStateHandler!('active'));
    expect(service.setAutoRefresh).toHaveBeenLastCalledWith(true);
  });

  it('al salir deja de renovar y de escuchar el estado de la app', async () => {
    const service = createFakeAuthService({ restore: async () => TEST_SESSION });
    await renderProvider(service);
    await waitFor(() => expect(status()).toBe('signedIn:ana@example.com'));

    await act(async () => service.emitSignedOut());
    expect(service.setAutoRefresh).toHaveBeenLastCalledWith(false);
    expect(removeAppStateListener).toHaveBeenCalled();
  });

  it('entra con la sesión que devuelve el servicio y cierra sesión', async () => {
    const service = createFakeAuthService();
    await renderProvider(service);
    await waitFor(() => expect(status()).toBe('signedOut'));

    await act(async () => auth!.signIn(TEST_SESSION));
    expect(status()).toBe('signedIn:ana@example.com');

    await act(() => auth!.signOut());
    expect(service.signOut).toHaveBeenCalledTimes(1);
    expect(status()).toBe('signedOut');
  });

  it('la limpieza al cerrar sesión corre después de salir de las pantallas con sesión', async () => {
    const order: string[] = [];
    function SignedInMarker() {
      const { state } = useAuth();
      useEffect(() => {
        if (state.status !== 'signedIn') {
          return;
        }
        order.push('montada');
        return () => {
          order.push('desmontada');
        };
      }, [state.status]);
      return null;
    }
    const service = createFakeAuthService({ restore: async () => TEST_SESSION });
    await render(
      <AuthProvider service={service}>
        <Capture onAuth={capture} />
        <SignedInMarker />
      </AuthProvider>,
    );
    await waitFor(() => expect(order).toEqual(['montada']));

    // La promesa termina con la limpieza, que corre en un efecto: se espera fuera del act que
    // aplica el cambio de estado.
    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = auth!.signOut({
        cleanup: async () => {
          order.push('limpieza');
        },
      });
    });
    await act(() => done);
    expect(service.signOut).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['montada', 'desmontada', 'limpieza']);
  });

  it('la limpieza corre aunque la sesión ya estuviera cerrada', async () => {
    const service = createFakeAuthService();
    await renderProvider(service);
    await waitFor(() => expect(status()).toBe('signedOut'));
    const cleanup = jest.fn(async () => undefined);

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = auth!.signOut({ cleanup });
    });
    await act(() => done);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('useAuth fuera del proveedor avisa del error de programación', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Status />)).rejects.toThrow('AuthProvider');
  });
});
