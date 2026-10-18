import { createContext, useContext, useState, type ReactNode } from 'react';

import { appRepositoryDeps } from '@/db/app-deps';
import { getSupabase } from '@/lib/supabase/client';
import { createSupabaseRpc } from '@/lib/supabase/rpc';

import { createInvitationService, type InvitationService } from './invitation-service';

const InvitationServiceContext = createContext<InvitationService | null>(null);

/** Entrega un servicio ya creado a las pantallas. `AppInvitationProvider` crea el real; las pruebas, este. */
export function InvitationServiceProvider({
  service,
  children,
}: {
  service: InvitationService;
  children: ReactNode;
}) {
  return (
    <InvitationServiceContext.Provider value={service}>
      {children}
    </InvitationServiceContext.Provider>
  );
}

export function useInvitationService(): InvitationService {
  const service = useContext(InvitationServiceContext);
  if (!service) {
    throw new Error('useInvitationService solo se puede usar dentro de InvitationServiceProvider');
  }
  return service;
}

/**
 * El servicio de la app: las RPC de invitaciones con el cliente de Supabase de la sesión. El
 * cliente se busca al llamar, no al montar.
 */
export function AppInvitationProvider({ children }: { children: ReactNode }) {
  const [service] = useState(() =>
    createInvitationService(
      (name, args) => createSupabaseRpc(getSupabase().client)(name, args),
      appRepositoryDeps,
    ),
  );
  return <InvitationServiceProvider service={service}>{children}</InvitationServiceProvider>;
}
