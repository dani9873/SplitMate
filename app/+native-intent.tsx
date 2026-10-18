import { resolveIncomingLink } from '@/features/navigation/deep-links';
import { resolveIncomingInvite } from '@/features/invitations/invite-link';
import { setPendingInvite } from '@/features/invitations/pending-invite';

/**
 * Recibe cada enlace que abre la app desde fuera, antes de que Expo Router lo interprete. Pasan los
 * de `auth/callback` con parámetros validados y los enlaces de invitación (`https://<dominio>/i#…`
 * y `splitmate://i#…`); el resto va al inicio.
 *
 * Del enlace de invitación solo sale la ruta `/invite`: el token se valida aquí, se guarda en
 * memoria (y en el almacén seguro, por si hay que registrarse antes) y la pantalla lo lee de ahí.
 * Nunca viaja en la ruta ni en los parámetros del router.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const token = resolveIncomingInvite(path);
  if (token) {
    setPendingInvite(token);
    return '/invite';
  }
  return resolveIncomingLink(path);
}
