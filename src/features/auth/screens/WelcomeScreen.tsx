import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Screen, Text } from '@/ui';

/** Bienvenida, la primera pantalla sin sesión. */
export function WelcomeScreen() {
  const { t } = useTranslation();
  return (
    <Screen edges={['top', 'bottom']} testID="welcome-screen">
      <View className="flex-1 items-center justify-center gap-3 px-4">
        <Text variant="display" className="text-center">
          {t('auth.welcome.title')}
        </Text>
        <Text tone="muted" className="max-w-[320px] text-center">
          {t('auth.welcome.tagline')}
        </Text>
      </View>
    </Screen>
  );
}
