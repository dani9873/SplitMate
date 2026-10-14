import '@/ui/global.css';
import '@/i18n';

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';

import { AuthProvider, ConfigErrorScreen } from '@/features/auth';
import { loadAppAuthService } from '@/features/auth/app-auth-service';
import { RootNavigator } from '@/features/navigation';
import { usePreferences, useSystemLanguageSync } from '@/features/settings';
import { logger } from '@/lib/logger';
import { fontAssets, ThemeProvider } from '@/ui';

// El splash nativo sigue visible hasta que la primera pantalla está lista para pintarse.
void SplashScreen.preventAutoHideAsync();
// Expo Go no admite personalizar la salida del splash; en las builds propias sí.
if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  SplashScreen.setOptions({ duration: 250, fade: true });
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const preferencesReady = usePreferences((state) => state.hydrated);
  // Sin las variables de Supabase, la app explica el problema en lugar de cerrarse.
  const [auth] = useState(loadAppAuthService);
  useSystemLanguageSync();

  useEffect(() => {
    if (fontError) {
      logger.warn('No se pudo cargar Manrope; se usa la fuente del sistema.', fontError);
    }
  }, [fontError]);

  const hideSplash = useCallback(() => SplashScreen.hide(), []);

  // Hay fuentes (o fallaron: se sigue con las del sistema en lugar de quedarse en el splash) y
  // ya se aplicaron el idioma y el tema guardados. El navegador espera además a la sesión.
  if (!preferencesReady || (!fontsLoaded && fontError == null)) {
    return null;
  }

  if ('error' in auth) {
    return (
      <ThemeProvider onLayout={hideSplash}>
        <ConfigErrorScreen />
      </ThemeProvider>
    );
  }

  return (
    <AuthProvider service={auth.service}>
      <RootNavigator />
    </AuthProvider>
  );
}
