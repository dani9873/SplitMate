import { useRouter } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useAccountNotice } from '@/features/account/account-notice';
import { Banner, Button, Screen, Text, useAppTheme } from '@/ui';

/** Aviso después de cerrar sesión borrando datos o de borrar la cuenta. */
function AccountNoticeBanner() {
  const { t } = useTranslation();
  const notice = useAccountNotice((state) => state.notice);
  const clear = useAccountNotice((state) => state.clear);
  if (!notice) {
    return null;
  }
  return (
    <Banner
      testID="account-notice"
      icon={CircleCheck}
      tone={notice === 'accountDeleted' || notice === 'dataDeleted' ? 'info' : 'warning'}
      message={t(`account.notices.${notice}`)}
      actions={
        <Button label={t('account.notices.dismiss')} size="sm" variant="ghost" onPress={clear} />
      }
      className="mt-4"
    />
  );
}

/** Bienvenida, la primera pantalla sin sesión: crear cuenta o entrar. */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useAppTheme();
  return (
    <Screen edges={['top', 'bottom']} testID="welcome-screen">
      <AccountNoticeBanner />
      <View className="flex-1 items-center justify-center gap-4">
        {/* El motivo de la marca: las dos mitades desplazadas de una moneda. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width={112} height={112} viewBox="0 0 128 128">
            <Path d="M60 14 A44 44 0 0 0 60 102 Z" fill={colors.primary} />
            <Path d="M68 26 A44 44 0 0 1 68 114 Z" fill={colors.accentSoft} />
          </Svg>
        </View>
        <Text variant="display" className="text-center">
          {t('auth.welcome.title')}
        </Text>
        <Text tone="muted" className="max-w-[320px] text-center">
          {t('auth.welcome.tagline')}
        </Text>
      </View>
      <View className="gap-3 pb-6">
        <Button
          testID="welcome-create-account"
          label={t('auth.welcome.createAccount')}
          onPress={() => router.push('/sign-up')}
          fullWidth
        />
        <Button
          testID="welcome-sign-in"
          label={t('auth.welcome.signIn')}
          variant="secondary"
          onPress={() => router.push('/sign-in')}
          fullWidth
        />
      </View>
    </Screen>
  );
}
