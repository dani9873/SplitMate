import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Button, Screen, Text, useAppTheme } from '@/ui';

import { GoogleButton, useGoogleSignIn } from './GoogleButton';
import { FormError } from './parts';

/** Bienvenida, la primera pantalla sin sesión: Google (Android), crear cuenta o entrar. */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useAppTheme();
  const [error, setError] = useState<string | null>(null);
  const google = useGoogleSignIn(setError);
  return (
    <Screen edges={['top', 'bottom']} testID="welcome-screen">
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
        <FormError message={error} />
        {google.available ? (
          <GoogleButton testID="welcome-google" busy={google.busy} onPress={google.start} />
        ) : null}
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
