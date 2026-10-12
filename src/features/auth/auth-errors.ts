import {
  isAuthApiError,
  isAuthPKCECodeVerifierMissingError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js';

/**
 * Errores de auth que la app sabe explicar. Cada código tiene su texto en
 * `auth.errors.<código>`. Ninguno revela si un correo tiene cuenta: "credenciales incorrectas"
 * cubre correo inexistente y contraseña equivocada.
 */
export type AuthErrorCode =
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'tooManyAttempts'
  | 'weakPassword'
  | 'samePassword'
  | 'invalidEmail'
  | 'emailNotAllowed'
  | 'invalidCode'
  | 'linkExpired'
  | 'sessionExpired'
  | 'googleNoAccount'
  | 'googleFailed'
  | 'offline'
  | 'unavailable'
  | 'unknown';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Códigos de error de la API de Auth (GoTrue) que tienen un texto propio. */
const API_CODES: Readonly<Record<string, AuthErrorCode>> = {
  invalid_credentials: 'invalidCredentials',
  email_not_confirmed: 'emailNotConfirmed',
  over_request_rate_limit: 'tooManyAttempts',
  over_email_send_rate_limit: 'tooManyAttempts',
  weak_password: 'weakPassword',
  same_password: 'samePassword',
  email_address_invalid: 'invalidEmail',
  email_address_not_authorized: 'emailNotAllowed',
  otp_expired: 'invalidCode',
  flow_state_expired: 'linkExpired',
  flow_state_not_found: 'linkExpired',
  bad_code_verifier: 'linkExpired',
  session_not_found: 'sessionExpired',
  session_expired: 'sessionExpired',
  refresh_token_not_found: 'sessionExpired',
  refresh_token_already_used: 'sessionExpired',
  user_not_found: 'sessionExpired',
  signup_disabled: 'unavailable',
  email_provider_disabled: 'unavailable',
  provider_disabled: 'unavailable',
};

/** Convierte un error de supabase-js (o cualquiera) en un AuthError con código conocido. */
export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) {
    return error;
  }
  if (isAuthWeakPasswordError(error)) {
    return new AuthError('weakPassword');
  }
  if (isAuthRetryableFetchError(error)) {
    // Estado 0: la petición no salió (sin red). 502-504: Supabase no respondió.
    return new AuthError(error.status === 0 ? 'offline' : 'unavailable');
  }
  if (isAuthPKCECodeVerifierMissingError(error)) {
    // El enlace se pidió en otro teléfono o en una instalación anterior.
    return new AuthError('linkExpired');
  }
  if (isAuthSessionMissingError(error)) {
    return new AuthError('sessionExpired');
  }
  if (isAuthApiError(error)) {
    const known = error.code ? API_CODES[error.code] : undefined;
    if (known) {
      return new AuthError(known);
    }
    if (error.status === 429) {
      return new AuthError('tooManyAttempts');
    }
    if (error.status >= 500) {
      return new AuthError('unavailable');
    }
  }
  return new AuthError('unknown');
}

/** Errores con los que un registro termina como si hubiera funcionado: no revelan la cuenta. */
export function isExistingAccountError(error: unknown): boolean {
  return (
    isAuthApiError(error) && (error.code === 'user_already_exists' || error.code === 'email_exists')
  );
}
