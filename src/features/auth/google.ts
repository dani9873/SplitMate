import { AuthError } from './auth-errors';

/** El módulo nativo `modules/splitmate-google-auth` (solo Android). */
export interface GoogleAuthModule {
  signIn(
    webClientId: string,
    hashedNonce: string,
  ): Promise<{ idToken: string; displayName: string | null }>;
}

export interface GoogleSignInDeps {
  /** `null` donde no existe: iOS y Expo Go. */
  module: GoogleAuthModule | null;
  /** Id del cliente OAuth "Aplicación web" de Google Cloud; `null` si falta en el `.env`. */
  webClientId: string | null;
  randomBytes(length: number): Uint8Array;
  sha256Hex(text: string): Promise<string>;
}

const NONCE_BYTES = 32;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export function isGoogleSignInAvailable({ module, webClientId }: GoogleSignInDeps): boolean {
  return module !== null && webClientId !== null;
}

/**
 * Pide a Google un ID token atado a un nonce. Google recibe el SHA-256 del nonce y la app guarda
 * el original para Supabase, que compara los dos: un ID token robado no sirve para otra sesión.
 * Devuelve `null` si el usuario cerró la hoja de Google.
 */
export async function requestGoogleIdToken(
  deps: GoogleSignInDeps,
): Promise<{ idToken: string; nonce: string } | null> {
  const { module, webClientId } = deps;
  if (module === null || webClientId === null) {
    throw new AuthError('googleFailed', 'Google no está disponible en este build');
  }
  const nonce = toHex(deps.randomBytes(NONCE_BYTES));
  try {
    const { idToken } = await module.signIn(webClientId, await deps.sha256Hex(nonce));
    return { idToken, nonce };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'CANCELED') {
      return null;
    }
    throw new AuthError(code === 'NO_ACCOUNT' ? 'googleNoAccount' : 'googleFailed');
  }
}
