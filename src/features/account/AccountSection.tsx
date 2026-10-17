import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAuth } from '@/features/auth';
import { Button, Card, Text } from '@/ui';

import { SignOutSheet } from './SignOutSheet';
import { useGuardedRouter } from '@/features/navigation/use-guarded-router';

/** Sección Cuenta de Ajustes: con qué cuenta entraste, cerrar sesión y borrar la cuenta. */
export function AccountSection() {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  const { state } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  if (state.status !== 'signedIn') {
    return null;
  }
  const { email } = state.session;

  return (
    <View className="gap-3" testID="account-section">
      <Text variant="subheading" accessibilityRole="header">
        {t('account.title')}
      </Text>
      <Card className="gap-1 px-4 py-3">
        <Text variant="bodyStrong">{t('account.signedInAs', { email })}</Text>
      </Card>
      <Button
        testID="account-sign-out"
        label={t('account.signOut')}
        variant="secondary"
        onPress={() => setSigningOut(true)}
        fullWidth
      />
      <Button
        testID="account-delete"
        label={t('account.delete')}
        variant="ghost"
        onPress={() => router.push('/account/delete')}
        fullWidth
      />
      <SignOutSheet visible={signingOut} onClose={() => setSigningOut(false)} />
    </View>
  );
}
