import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { z } from 'zod';

import { useAuth, type AuthSession } from '@/features/auth';
import { FormError, PasswordField, useAuthErrorText } from '@/features/auth/screens/parts';
import { Button, Input, Screen, Text } from '@/ui';

import { ScreenHeader } from '../navigation';
import { wipeAccountData } from './account-actions';

/**
 * Borrar la cuenta: explica qué se borra, pide el correo exacto y vuelve a pedir la contraseña
 * para que la Edge Function vea una sesión reciente. Después cierra la sesión y borra los datos de
 * la cuenta en este teléfono.
 */
export function DeleteAccountScreen() {
  const { state } = useAuth();
  if (state.status !== 'signedIn') {
    return null;
  }
  return <DeleteAccount session={state.session} />;
}

function formSchema(email: string) {
  return z.object({
    email: z
      .string()
      .trim()
      .refine((value) => value.toLowerCase() === email.toLowerCase(), 'emailMismatch'),
    password: z.string().min(1, 'passwordRequired'),
  });
}

function DeleteAccount({ session }: { session: AuthSession }) {
  const { t } = useTranslation();
  const { service, signOut } = useAuth();
  const errorText = useAuthErrorText();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const schema = useMemo(() => formSchema(session.email), [session.email]);
  const { control, handleSubmit, formState } = useForm<z.input<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });
  const fieldError = (message?: string) => {
    if (!message) {
      return undefined;
    }
    return message === 'emailMismatch'
      ? t('account.deleteScreen.emailMismatch')
      : t('auth.validation.passwordRequired');
  };

  const submit = handleSubmit(async ({ password }) => {
    setSubmitError(null);
    try {
      await service.reauthenticateWithPassword(session, password);
      await service.deleteAccount();
      await signOut({
        cleanup: wipeAccountData(session.userId, {
          done: 'accountDeleted',
          failed: 'accountDeletedDataKept',
        }),
      });
    } catch (error) {
      setSubmitError(errorText(error));
    }
  });

  return (
    <Screen scroll edges={['top', 'bottom']} testID="delete-account-screen">
      <ScreenHeader title={t('account.deleteScreen.title')} variant="modal" />
      <View className="gap-2">
        <Text>{t('account.deleteScreen.intro')}</Text>
        {(['itemAccount', 'itemPhone', 'itemGroups'] as const).map((item) => (
          <View key={item} className="flex-row gap-2">
            <Text tone="muted">{'•'}</Text>
            <Text tone="muted" className="flex-1">
              {t(`account.deleteScreen.${item}`)}
            </Text>
          </View>
        ))}
      </View>
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            testID="delete-account-email"
            label={t('account.deleteScreen.email')}
            placeholder={session.email}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldError(fieldState.error?.message)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            maxLength={254}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <PasswordField
            ref={field.ref}
            testID="delete-account-password"
            label={t('account.deleteScreen.password')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldError(fieldState.error?.message)}
            autoComplete="current-password"
            textContentType="password"
          />
        )}
      />
      <FormError message={submitError} />
      <Button
        testID="delete-account-submit"
        label={t('account.deleteScreen.submit')}
        variant="danger"
        onPress={submit}
        loading={formState.isSubmitting}
        fullWidth
      />
    </Screen>
  );
}
