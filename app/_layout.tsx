import '@/ui/global.css';
import '@/i18n';

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect } from 'react';

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
  useSystemLanguageSync();

  useEffect(() => {
    if (fontError) {
      logger.warn('No se pudo cargar Manrope; se usa la fuente del sistema.', fontError);
    }
  }, [fontError]);

  // Lista cuando hay fuentes (o fallaron: se sigue con las del sistema en lugar de
  // quedarse en el splash) y ya se aplicaron el idioma y el tema guardados.
  const ready = preferencesReady && (fontsLoaded || fontError != null);

  const hideSplash = useCallback(() => {
    if (ready) {
      SplashScreen.hide();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <ThemeProvider onLayout={hideSplash}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
