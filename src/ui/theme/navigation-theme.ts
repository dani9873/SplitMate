import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

import { fontFamily, palette, type ColorScheme } from './tokens';

// Con fuentes propias cada peso es una familia distinta; `fontWeight` debe quedar en
// 'normal' para que Android no sintetice negritas ni caiga en la fuente del sistema.
const fonts: Theme['fonts'] = {
  regular: { fontFamily: fontFamily.regular, fontWeight: 'normal' },
  medium: { fontFamily: fontFamily.semibold, fontWeight: 'normal' },
  bold: { fontFamily: fontFamily.bold, fontWeight: 'normal' },
  heavy: { fontFamily: fontFamily.extrabold, fontWeight: 'normal' },
};

function buildTheme(base: Theme, scheme: ColorScheme): Theme {
  const colors = palette[scheme];
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.fg,
      border: colors.line,
      notification: colors.accent,
    },
    fonts,
  };
}

/** Tema de navegación (encabezados, pestañas, transiciones) derivado de los tokens. */
export const navigationThemes: Record<ColorScheme, Theme> = {
  light: buildTheme(DefaultTheme, 'light'),
  dark: buildTheme(DarkTheme, 'dark'),
};
