import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { Button, Input } from '@/ui';

import { AuthError } from '../auth-errors';
import { signInFormSchema } from '../auth-form';
import { useAuth } from '../AuthProvider';
import { AuthScreen, FormError, PasswordField, useAuthErrorText, useValidationText } from './parts';

type Form = z.input<typeof signInFormSchema>;
type Values = z.output<typeof signInFormSchema>;

/** Entrar con correo y contraseña. Un correo sin confirmar ofrece reenviar la confirmación. */
export function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { service, signIn } = useAuth();
  const validation = useValidationText();
  const errorText = useAuthErrorText();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const { control, handleSubmit, formState, getValues } = useForm<Form, unknown, Values>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: {
      email: typeof params.email === 'string' ? params.email.slice(0, 254) : '',
      password: '',
    },
  });

  const submit = handleSubmit(async ({ email, password }) => {
    setSubmitError(null);
    setUnconfirmedEmail(null);
    try {
      // Con la sesión, las rutas protegidas llevan a la app.
      signIn(await service.signIn(email, password));
    } catch (error) {
      setSubmitError(errorText(error));
      if (error instanceof AuthError && error.code === 'emailNotConfirmed') {
        setUnconfirmedEmail(email);
      }
    }
  });

  const resendConfirmation = async () => {
    if (!unconfirmedEmail) {
      return;
    }
    try {
      await service.resend(unconfirmedEmail, 'signup');
      router.push({
        pathname: '/check-email',
        params: { flow: 'signup', email: unconfirmedEmail },
      });
    } catch (error) {
      setSubmitError(errorText(error));
    }
  };

  return (
    <AuthScreen title={t('auth.signIn.title')} testID="sign-in-screen">
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            testID="sign-in-email"
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
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <PasswordField
            ref={field.ref}
            testID="sign-in-password"
            label={t('auth.fields.password')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validation(fieldState.error?.message)}
            autoComplete="current-password"
            textContentType="password"
          />
        )}
      />
      <FormError message={submitError} />
      {unconfirmedEmail ? (
        <Button
          testID="sign-in-resend-confirmation"
          label={t('auth.signIn.resendConfirmation')}
          variant="secondary"
          onPress={resendConfirmation}
          fullWidth
        />
      ) : null}
      <Button
        testID="sign-in-submit"
        label={t('auth.signIn.submit')}
        onPress={submit}
        loading={formState.isSubmitting}
        fullWidth
      />
      <Button
        testID="sign-in-forgot"
        label={t('auth.signIn.forgot')}
        variant="ghost"
        onPress={() =>
          router.push({ pathname: '/forgot-password', params: { email: getValues('email') } })
        }
        fullWidth
      />
      <Button
        label={t('auth.signIn.noAccount')}
        variant="ghost"
        onPress={() => router.replace('/sign-up')}
        fullWidth
      />
    </AuthScreen>
  );
}
