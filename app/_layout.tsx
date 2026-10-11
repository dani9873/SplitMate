import '@/ui/global.css';
import '@/i18n';

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect } from 'react';

import { openAppDatabase } from '@/db/client';
import { DatabaseGate, useDatabaseSetup } from '@/db/DatabaseProvider';
import { usePreferences, useSystemLanguageSync } from '@/features/settings';
import { UndoProvider } from '@/features/undo';
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
  const database = useDatabaseSetup(openAppDatabase);
  useSystemLanguageSync();

  useEffect(() => {
    if (fontError) {
      logger.warn('No se pudo cargar Manrope; se usa la fuente del sistema.', fontError);
    }
  }, [fontError]);

  // Lista cuando hay fuentes (o fallaron: se sigue con las del sistema en lugar de
  // quedarse en el splash), ya se aplicaron el idioma y el tema guardados y la base terminó
  // su primer intento de apertura. Si la base falló, se muestra su pantalla de error.
  const ready = preferencesReady && (fontsLoaded || fontError != null) && database.settledOnce;

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
    </ThemeProvider>
  );
}
