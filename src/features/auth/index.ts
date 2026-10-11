// El servicio de la app (app-auth-service) no se exporta aquí: carga el cliente de Supabase y el
// almacenamiento nativo. Solo lo importa el layout raíz.
export { AuthError, type AuthErrorCode } from './auth-errors';
export {
  AUTH_REDIRECT_URL,
  type AuthService,
  type AuthSession,
  type EmailFlow,
  type SignUpInput,
} from './auth-service';
export { AuthProvider, useAuth, type AuthState } from './AuthProvider';
export { ConfigErrorScreen } from './ConfigErrorScreen';
export { WelcomeScreen } from './screens/WelcomeScreen';
