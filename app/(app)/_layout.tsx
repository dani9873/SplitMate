import { Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openAccountDatabase } from '@/db/client';
import { DatabaseGate, useDatabaseSetup } from '@/db/DatabaseProvider';
import { useAuth, type AuthSession } from '@/features/auth';
import { SyncNotices, SyncProvider } from '@/features/sync';
import { UndoProvider } from '@/features/undo';

/**
 * Pantallas con sesión: las de las Fases 1 y 2. Abren la base local de la cuenta y la cierran al
 * cerrar sesión, cuando este layout se desmonta.
 */
export default function AppLayout() {
  const { state } = useAuth();
  // Las rutas protegidas solo muestran este grupo con sesión.
  if (state.status !== 'signedIn') {
    return null;
  }
  return <AccountArea session={state.session} />;
}

function AccountArea({ session }: { session: AuthSession }) {
  const { t } = useTranslation();
  const { service } = useAuth();
  const { userId, email, displayName } = session;
  // Sin nombre en la cuenta (una creada fuera de la app, sin `display_name`), nunca el correo:
  // "Usuario". Se fija al montar: cambiar el idioma no debe reabrir la base.
  const [fallbackName] = useState(() => t('account.defaultName'));
  const open = useCallback(
    () => openAccountDatabase({ userId, email, displayName, fallbackName }),
    [userId, email, displayName, fallbackName],
  );
  const database = useDatabaseSetup(open);

  // El motor de sincronización asegura el perfil remoto: al entrar o al abrir la app con sesión, y
  // otra vez en el siguiente ciclo si no hubo red.
  const ensureProfile = useCallback(
    () => service.ensureProfile({ userId, displayName: displayName ?? fallbackName }),
    [service, userId, displayName, fallbackName],
  );
  return (
    <DatabaseGate database={database}>
      <SyncProvider ensureProfile={ensureProfile}>
        <UndoProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            {/* Los formularios suben como modales: se cierran y vuelven a donde estabas. */}
            <Stack.Screen name="groups/new" options={{ presentation: 'modal' }} />
            <Stack.Screen name="groups/[groupId]/entries/new" options={{ presentation: 'modal' }} />
            <Stack.Screen
              name="groups/[groupId]/entries/[entryId]/edit"
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen name="account/delete" options={{ presentation: 'modal' }} />
          </Stack>
          <SyncNotices />
        </UndoProvider>
      </SyncProvider>
    </DatabaseGate>
  );
}
