// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  prettierRecommended,
  {
    // expo-env.d.ts lo genera Expo al arrancar y no se versiona.
    ignores: ['dist/*', 'coverage/*', 'android/*', 'ios/*', '.expo/*', 'expo-env.d.ts'],
  },
  {
    // Los mocks de Jest usan require() dentro de sus fábricas.
    files: ['jest.setup.ts', '**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
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
