import { Stack } from 'expo-router';
import { useCallback } from 'react';

import { openAccountDatabase } from '@/db/client';
import { DatabaseGate, useDatabaseSetup } from '@/db/DatabaseProvider';
import { useAuth, type AuthSession } from '@/features/auth';
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
  const { userId, email, displayName } = session;
  const open = useCallback(
    () => openAccountDatabase({ userId, email, displayName }),
    [userId, email, displayName],
  );
  const database = useDatabaseSetup(open);
  return (
    <DatabaseGate database={database}>
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
        </Stack>
      </UndoProvider>
    </DatabaseGate>
  );
}
