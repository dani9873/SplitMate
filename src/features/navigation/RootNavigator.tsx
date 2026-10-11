import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback } from 'react';

import { useAuth } from '@/features/auth';
import { ThemeProvider } from '@/ui';

/**
 * Rutas de la app según la sesión. Sin sesión solo existen las de `(auth)`; con sesión, las de
 * `(app)`; recuperando la contraseña, solo `reset-password`. Si la sesión cambia, Expo Router
 * lleva a la primera pantalla disponible. `auth/callback`, destino de los correos, existe
 * siempre. Mientras se restaura la sesión guardada, el splash nativo sigue visible.
 */
export function RootNavigator() {
  const { state } = useAuth();
  const hideSplash = useCallback(() => SplashScreen.hide(), []);
  if (state.status === 'restoring') {
    return null;
  }
  const signedIn = state.status === 'signedIn';
  const recovering = signedIn && state.recovering;
  return (
    <ThemeProvider onLayout={hideSplash}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn && !recovering}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={recovering}>
          <Stack.Screen name="reset-password" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Screen name="auth/callback" />
      </Stack>
    </ThemeProvider>
  );
}
