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
      // Entradas Deno de las Edge Functions (imports npm: y el global Deno). Su handler.ts sí
      // pasa por el lint.
      'supabase/functions/*/index.ts',
    ],
  },
  {
    // Procesos hijo de las pruebas (PGlite): scripts de Node puro, con require y __dirname.
    files: ['src/test/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', process: 'readonly', require: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
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
    // NativeWind convierte en Pressable un View o Text con clases active:, focus: o hover:.
    // Dentro de un botón, ese Pressable sin acción se queda con el toque (le pasó al
    // calendario). El estado presionado va en el Pressable: active: o ({ pressed }) => ...
    files: ['app/**/*.tsx', 'src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['Literal[value', 'TemplateElement[value.raw'].map((node) => ({
          selector: `JSXOpeningElement[name.name=/^(View|Text)$/] > JSXAttribute[name.name='className'] ${node}=/(^|\\s)(active|focus|hover):/]`,
          message:
            'NativeWind convierte este View o Text en un Pressable que roba el toque. Pon el estado presionado en el Pressable (active: o su función ({ pressed })).',
        })),
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
