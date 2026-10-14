import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { Button, Input } from '@/ui';

import { signUpFormSchema } from '../auth-form';
import { useAuth } from '../AuthProvider';
import { AuthScreen, FormError, PasswordField, useAuthErrorText, useValidationText } from './parts';

type Form = z.input<typeof signUpFormSchema>;
type Values = z.output<typeof signUpFormSchema>;

/** Crear cuenta: nombre, correo y contraseña. Después, "Revisa tu correo". */
export function SignUpScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { service } = useAuth();
  const validation = useValidationText();
  const errorText = useAuthErrorText();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Form, unknown, Values>({
    resolver: zodResolver(signUpFormSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const submit = handleSubmit(async ({ name, email, password }) => {
    setSubmitError(null);
    try {
      await service.signUp({ email, password, displayName: name, locale: i18n.language });
      // Con un correo ya registrado también se llega aquí: la pantalla no revela cuentas.
      router.replace({ pathname: '/check-email', params: { flow: 'signup', email } });
    } catch (error) {
      setSubmitError(errorText(error));
    }
  });

  return (
    <AuthScreen title={t('auth.signUp.title')} testID="sign-up-screen">
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            testID="sign-up-name"
            label={t('auth.fields.name')}
            placeholder={t('auth.fields.namePlaceholder')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validation(fieldState.error?.message)}
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            maxLength={80}
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            testID="sign-up-email"
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
            testID="sign-up-password"
            label={t('auth.fields.password')}
            hint={t('auth.fields.passwordHint')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validation(fieldState.error?.message)}
            autoComplete="new-password"
            textContentType="newPassword"
          />
        )}
      />
      <FormError message={submitError} />
      <Button
        testID="sign-up-submit"
        label={t('auth.signUp.submit')}
        onPress={submit}
        loading={formState.isSubmitting}
        fullWidth
      />
      <Button
        label={t('auth.signUp.haveAccount')}
        variant="ghost"
        onPress={() => router.replace('/sign-in')}
        fullWidth
      />
    </AuthScreen>
  );
}
