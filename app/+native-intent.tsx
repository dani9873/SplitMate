import { resolveIncomingLink } from '@/features/navigation/deep-links';

/**
 * Recibe cada enlace que abre la app desde fuera, antes de que Expo Router lo interprete. Solo
 * pasan los de `auth/callback` con parámetros validados; el resto va al inicio.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return resolveIncomingLink(path);
}
