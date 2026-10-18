import { createContext, useContext, useState, type ReactNode } from 'react';

import { getSupabase } from '@/lib/supabase/client';
import { createSupabaseRpc } from '@/lib/supabase/rpc';

import { createAccessService, type AccessService } from './access-service';

const AccessServiceContext = createContext<AccessService | null>(null);

/** Entrega un servicio ya creado a las pantallas. `AppAccessProvider` crea el real; las pruebas, este. */
export function AccessServiceProvider({
  service,
  children,
}: {
  service: AccessService;
  children: ReactNode;
}) {
  return <AccessServiceContext.Provider value={service}>{children}</AccessServiceContext.Provider>;
}

export function useAccessService(): AccessService {
  const service = useContext(AccessServiceContext);
  if (!service) {
    throw new Error('useAccessService solo se puede usar dentro de AccessServiceProvider');
  }
  return service;
}

/**
 * El servicio de la app: las RPC de acceso con el cliente de Supabase de la sesión. El cliente se
 * busca al llamar, no al montar: las pantallas que no lo usan no dependen de la configuración.
 */
export function AppAccessProvider({ children }: { children: ReactNode }) {
  const [service] = useState(() =>
    createAccessService((name, args) => createSupabaseRpc(getSupabase().client)(name, args)),
  );
  return <AccessServiceProvider service={service}>{children}</AccessServiceProvider>;
}
