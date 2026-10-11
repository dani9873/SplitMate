import { useLocales } from 'expo-localization';
import { Moon, Smartphone, Sun } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';

import {
  detectDeviceLanguage,
  getNativeName,
  supportedLanguages,
  type LanguagePreference,
} from '@/i18n';
import { Screen } from '@/ui';

import { OptionGroup, type Option } from './components/OptionGroup';
import type { ThemePreference } from './preferences';
import { usePreferences } from './preferences-store';

// Solo en desarrollo: en producción Metro elimina esta rama y el módulo de datos de ejemplo.
// `npm run check:bundle` lo verifica en CI.
const SampleDataButton: ComponentType | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/features/sample-data').SampleDataButton
  : null;

/** Ajustes de la app: idioma y apariencia. Los cambios se aplican al instante. */
export function SettingsScreen() {
  const { t } = useTranslation();
  const locales = useLocales();
  const language = usePreferences((state) => state.language);
  const theme = usePreferences((state) => state.theme);
  const setLanguage = usePreferences((state) => state.setLanguage);
  const setTheme = usePreferences((state) => state.setTheme);

  const deviceLanguage = getNativeName(detectDeviceLanguage(locales));

  const languageOptions: Option<LanguagePreference>[] = [
    {
      value: 'system',
      label: t('settings.language.system'),
      hint: t('settings.language.systemHint', { language: deviceLanguage }),
    },
    // Cada idioma se nombra en su propio idioma, como hacen los sistemas operativos.
    ...supportedLanguages.map((code) => ({ value: code, label: getNativeName(code) })),
  ];

  const themeOptions: Option<ThemePreference>[] = [
    {
      value: 'system',
      label: t('settings.theme.system'),
      hint: t('settings.theme.systemHint'),
      icon: Smartphone,
    },
    { value: 'light', label: t('settings.theme.light'), icon: Sun },
    { value: 'dark', label: t('settings.theme.dark'), icon: Moon },
  ];

  return (
    <Screen title={t('settings.title')} scroll>
      <OptionGroup
        title={t('settings.language.title')}
        options={languageOptions}
        value={language}
        onChange={setLanguage}
      />
      <OptionGroup
        title={t('settings.theme.title')}
        options={themeOptions}
        value={theme}
        onChange={setTheme}
      />
      {SampleDataButton ? <SampleDataButton /> : null}
    </Screen>
  );
}
