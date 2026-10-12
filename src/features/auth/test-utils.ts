import type { AuthService, AuthSession } from './auth-service';

export const TEST_SESSION: AuthSession = {
  userId: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  email: 'ana@example.com',
  providers: ['email'],
  displayName: 'Ana',
};

export type FakeAuthService = { [K in keyof AuthService]: jest.Mock } & {
  /** Simula que Supabase cerró la sesión (rechazo definitivo o cierre de sesión). */
  emitSignedOut(): void;
};

/** Servicio de auth falso para pruebas de pantallas y del proveedor. Todo funciona por omisión. */
export function createFakeAuthService(overrides: Partial<AuthService> = {}): FakeAuthService {
  const listeners = new Set<() => void>();
  const service = {
    restore: jest.fn(async () => null),
    signUp: jest.fn(async () => undefined),
    signIn: jest.fn(async () => TEST_SESSION),
    verifyCode: jest.fn(async () => TEST_SESSION),
    resend: jest.fn(async () => undefined),
    exchangeCode: jest.fn(async () => ({ session: TEST_SESSION, recovery: false })),
    requestPasswordReset: jest.fn(async () => undefined),
    updatePassword: jest.fn(async () => undefined),
    signOut: jest.fn(async () => undefined),
    setAutoRefresh: jest.fn(),
    onSignedOut: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    ensureProfile: jest.fn(async () => undefined),
    canUseGoogle: jest.fn(() => false),
    signInWithGoogle: jest.fn(async () => TEST_SESSION),
    emitSignedOut: () => listeners.forEach((listener) => listener()),
  };
  for (const [name, implementation] of Object.entries(overrides)) {
    (service as unknown as Record<string, jest.Mock>)[name]!.mockImplementation(
      implementation as (...args: unknown[]) => unknown,
    );
  }
  return service;
}
