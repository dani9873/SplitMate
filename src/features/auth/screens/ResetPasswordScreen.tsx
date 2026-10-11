import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { Button } from '@/ui';

import { resetPasswordFormSchema } from '../auth-form';
import { useAuth } from '../AuthProvider';
import { AuthScreen, FormError, PasswordField, useAuthErrorText, useValidationText } from './parts';

type Form = z.input<typeof resetPasswordFormSchema>;
type Values = z.output<typeof resetPasswordFormSchema>;

/**
 * Contraseña nueva, con la sesión del correo de recuperación. Al guardarla, la app sigue sola a
 * las pantallas con sesión. Cancelar cierra esa sesión.
 */
export function ResetPasswordScreen() {
  const { t } = useTranslation();
  const { service, finishRecovery, signOut } = useAuth();
  const validation = useValidationText();
  const errorText = useAuthErrorText();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Form, unknown, Values>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: '' },
  });

  const submit = handleSubmit(async ({ password }) => {
    setSubmitError(null);
    try {
      await service.updatePassword(password);
      finishRecovery();
    } catch (error) {
      setSubmitError(errorText(error));
    }
  });

  return (
    <AuthScreen
      title={t('auth.reset.title')}
      description={t('auth.reset.body')}
      back={false}
      testID="reset-password-screen"
    >
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <PasswordField
            ref={field.ref}
            testID="reset-password-password"
            label={t('auth.fields.newPassword')}
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
        testID="reset-password-submit"
        label={t('auth.reset.submit')}
        onPress={submit}
        loading={formState.isSubmitting}
        fullWidth
      />
      <Button
        testID="reset-password-cancel"
        label={t('common.cancel')}
        variant="ghost"
        onPress={() => void signOut()}
        fullWidth
      />
    </AuthScreen>
  );
}
