// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  prettierRecommended,
  {
    // expo-env.d.ts lo genera Expo al arrancar y no se versiona.
    ignores: [
      'dist/*',
      'coverage/*',
      'android/*',
      'ios/*',
      '.expo/*',
      'expo-env.d.ts',
      // Generadas por drizzle-kit: no se editan a mano.
      'src/db/migrations/*',
    ],
  },
  {
    // Los mocks de Jest usan require() dentro de sus fábricas.
    files: ['jest.setup.ts', '**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Las pantallas y los componentes solo usan repositorios y dominio: nada de SQL, Drizzle
    // ni la conexión nativa. Las pruebas pueden preparar datos como necesiten.
    files: ['app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'expo-sqlite', message: 'Usa los repositorios de @/db/repositories.' }],
          patterns: [
            {
              group: [
                'drizzle-orm',
                'drizzle-orm/*',
                '@/db/schema',
                '@/db/migrations/*',
                '@/db/repositories/*',
              ],
              message: 'Usa los repositorios de @/db/repositories y las funciones de @/domain.',
            },
          ],
        },
      ],
    },
  },
  {
    // CLAUDE.md: cero textos fijos en componentes. Todo texto visible pasa por i18n.
    files: ['app/**/*.tsx', 'src/**/*.tsx'],
    ignores: ['**/__tests__/**', '**/*.test.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        { noStrings: true, ignoreProps: true, allowedStrings: ['·', '•', '/', ':', '%', '+', '-'] },
      ],
    },
  },
]);
