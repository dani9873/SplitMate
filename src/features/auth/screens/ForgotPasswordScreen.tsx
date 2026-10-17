import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { Button, Input } from '@/ui';

import { forgotPasswordFormSchema } from '../auth-form';
import { useAuth } from '../AuthProvider';
import { AuthScreen, FormError, useAuthErrorText, useValidationText } from './parts';
import { useGuardedRouter } from '@/features/navigation/use-guarded-router';

type Form = z.input<typeof forgotPasswordFormSchema>;
type Values = z.output<typeof forgotPasswordFormSchema>;

/** Recuperar la contraseña: el mismo mensaje exista o no la cuenta. */
export function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { service } = useAuth();
  const validation = useValidationText();
  const errorText = useAuthErrorText();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Form, unknown, Values>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: typeof params.email === 'string' ? params.email.slice(0, 254) : '' },
  });

  const submit = handleSubmit(async ({ email }) => {
    setSubmitError(null);
    try {
      await service.requestPasswordReset(email);
      router.replace({ pathname: '/check-email', params: { flow: 'recovery', email } });
    } catch (error) {
      setSubmitError(errorText(error));
    }
  });

  return (
    <AuthScreen
      title={t('auth.forgot.title')}
      description={t('auth.forgot.body')}
      testID="forgot-password-screen"
    >
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            testID="forgot-password-email"
            label={t('auth.fields.email')}
            placeholder={t('auth.fields.emailPlaceholder')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validation(fieldState.error?.message)}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
          />
        )}
      />
      <FormError message={submitError} />
      <Button
        testID="forgot-password-submit"
        label={t('auth.forgot.submit')}
        onPress={submit}
        loading={formState.isSubmitting}
        fullWidth
      />
    </AuthScreen>
  );
}
