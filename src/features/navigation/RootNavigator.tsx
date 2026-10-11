import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback } from 'react';

import { useAuth } from '@/features/auth';
import { ThemeProvider } from '@/ui';

/**
 * Rutas de la app según la sesión. Sin sesión solo existen las de `(auth)`; con sesión, las de
 * `(app)`. Si la sesión cambia, Expo Router lleva a la primera pantalla disponible. Mientras se
 * restaura la sesión guardada, el splash nativo sigue visible.
 */
export function RootNavigator() {
  const { state } = useAuth();
  const hideSplash = useCallback(() => SplashScreen.hide(), []);
  if (state.status === 'restoring') {
    return null;
  }
  const signedIn = state.status === 'signedIn';
  return (
    <ThemeProvider onLayout={hideSplash}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
