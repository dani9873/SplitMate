import { ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useColorScheme, vars } from 'nativewind';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { navigationThemes } from './navigation-theme';
import { cssVariables, palette, type ColorScheme, type ThemeColors } from './tokens';

export interface AppTheme {
  scheme: ColorScheme;
  /** Colores resueltos, para lo que no admite clases: íconos, navegación, indicadores. */
  colors: ThemeColors;
}

const ThemeContext = createContext<AppTheme>({ scheme: 'light', colors: palette.light });

const schemeVariables = {
  light: vars(cssVariables.light),
  dark: vars(cssVariables.dark),
};

interface ThemeProviderProps {
  children: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
}

/**
 * Aplica el tema efectivo (claro u oscuro) a toda la app: variables CSS para las clases
 * de Tailwind, tema de navegación, barra de estado y fondo de la ventana nativa.
 * El tema efectivo lo decide NativeWind a partir de la preferencia guardada.
 */
export function ThemeProvider({ children, onLayout }: ThemeProviderProps) {
  const { colorScheme } = useColorScheme();
  const scheme: ColorScheme = colorScheme === 'dark' ? 'dark' : 'light';
  const value = useMemo<AppTheme>(() => ({ scheme, colors: palette[scheme] }), [scheme]);

  useEffect(() => {
    // Evita destellos blancos detrás de las transiciones en modo oscuro.
    void SystemUI.setBackgroundColorAsync(palette[scheme].background);
  }, [scheme]);

  return (
    <ThemeContext.Provider value={value}>
      <NavigationThemeProvider value={navigationThemes[scheme]}>
        <View className="flex-1 bg-background" style={schemeVariables[scheme]} onLayout={onLayout}>
          {children}
        </View>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

/** Tema efectivo y colores resueltos. */
export function useAppTheme(): AppTheme {
  return useContext(ThemeContext);
}
