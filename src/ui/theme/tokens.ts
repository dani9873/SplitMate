import colors from './colors.json';
import { toCssVariables } from './css-variables';
import families from './fonts.json';

export type ColorScheme = 'light' | 'dark';
export type ColorToken = keyof typeof colors.light;
export type ThemeColors = Record<ColorToken, string>;

/** Colores semánticos por tema. `satisfies` exige que el modo oscuro tenga todos los tokens. */
export const palette = colors satisfies Record<ColorScheme, ThemeColors>;

/** Variables CSS que alimentan las clases semánticas de Tailwind (`bg-surface`, `text-fg`...). */
export const cssVariables: Record<ColorScheme, Record<string, string>> = {
  light: toCssVariables(palette.light),
  dark: toCssVariables(palette.dark),
};

/** Familias de Manrope por peso. Usa estas en lugar de `fontWeight` con fuentes propias. */
export const fontFamily = families;
