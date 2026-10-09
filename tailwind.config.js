const colors = require('./src/ui/theme/colors.json');
const { toCssVariableName, toCssVariables, toKebabCase } = require('./src/ui/theme/css-variables');
const fonts = require('./src/ui/theme/fonts.json');

// Cada token se expone como color semántico: `bg-surface`, `text-fg-muted`, `border-line`...
// El valor real llega por variables CSS que ThemeProvider cambia según el tema.
const semanticColors = Object.fromEntries(
  Object.keys(colors.light).map((token) => [
    toKebabCase(token),
    `rgb(var(${toCssVariableName(token)}) / <alpha-value>)`,
  ]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: semanticColors,
      fontFamily: {
        sans: [fonts.regular],
        'sans-medium': [fonts.medium],
        'sans-semibold': [fonts.semibold],
        'sans-bold': [fonts.bold],
        'sans-extrabold': [fonts.extrabold],
      },
      fontSize: {
        display: ['34px', { lineHeight: '40px', letterSpacing: '-0.6px' }],
        title: ['28px', { lineHeight: '34px', letterSpacing: '-0.4px' }],
        heading: ['20px', { lineHeight: '26px', letterSpacing: '-0.2px' }],
        subheading: ['17px', { lineHeight: '24px' }],
        body: ['16px', { lineHeight: '24px' }],
        label: ['14px', { lineHeight: '20px' }],
        caption: ['13px', { lineHeight: '18px' }],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '28px',
      },
    },
  },
  plugins: [
    // Valores por defecto (tema claro) para cualquier vista fuera de ThemeProvider.
    ({ addBase }) => addBase({ ':root': toCssVariables(colors.light) }),
  ],
};
