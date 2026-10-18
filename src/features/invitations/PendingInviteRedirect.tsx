import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useGuardedRouter } from '../navigation/use-guarded-router';
import { loadPendingInvite } from './pending-invite';

/**
 * Al entrar con sesión (y al abrir la app ya con sesión), si había un enlace de invitación pendiente
 * que llegó antes de iniciar sesión o de registrarse, lleva a la pantalla de unirse. El enlace sigue
 * pendiente hasta que se usa o vence (1 hora): esa pantalla lo consume. Si ya se está en ella (el
 * enlace llegó con la app abierta), no hace nada.
 */
export function PendingInviteRedirect() {
  const router = useGuardedRouter();
  const pathname = usePathname();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void loadPendingInvite().then((token) => {
      if (token && pathname !== '/invite') {
        router.push('/invite');
      }
    });
    // Solo al montarse: el estado de la ruta no debe volver a dispararlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
