import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { Button, Input } from '@/ui';

import { yourNameFormSchema } from '../auth-form';
import { useAuth } from '../AuthProvider';
import { AuthScreen, FormError, useAuthErrorText, useValidationText } from './parts';

type Form = z.input<typeof yourNameFormSchema>;
type Values = z.output<typeof yourNameFormSchema>;

/**
 * Recién entrado con una cuenta de Google sin nombre: pide cómo verán a la persona en los grupos y
 * lo guarda en la cuenta. "Ahora no" sigue con el nombre de respaldo ("Usuario"). Al terminar, la
 * app sigue sola a las pantallas con sesión.
 */
export function YourNameScreen() {
  const { t } = useTranslation();
  const { service, finishName } = useAuth();
  const validation = useValidationText();
  const errorText = useAuthErrorText();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Form, unknown, Values>({
    resolver: zodResolver(yourNameFormSchema),
    defaultValues: { name: '' },
  });

  const submit = handleSubmit(async ({ name }) => {
    setSubmitError(null);
    try {
      finishName(await service.updateDisplayName(name));
    } catch (error) {
      setSubmitError(errorText(error));
    }
  });

  return (
    <AuthScreen
      title={t('auth.yourName.title')}
      description={t('auth.yourName.body')}
      back={false}
      testID="your-name-screen"
    >
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            testID="your-name-name"
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
      <FormError message={submitError} />
      <Button
        testID="your-name-submit"
        label={t('auth.yourName.submit')}
        onPress={submit}
        loading={formState.isSubmitting}
        fullWidth
      />
      <Button
        testID="your-name-skip"
        label={t('auth.yourName.skip')}
        variant="ghost"
        onPress={() => finishName()}
        disabled={formState.isSubmitting}
        fullWidth
      />
    </AuthScreen>
  );
}
