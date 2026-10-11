import { zodResolver } from '@hookform/resolvers/zod';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { Button, Input, Text } from '@/ui';

import { checkEmailParamsSchema, codeFormSchema } from '../auth-form';
import type { EmailFlow } from '../auth-service';
import { useAuth } from '../AuthProvider';
import { useResendCooldown } from '../use-resend-cooldown';
import { AuthScreen, FormError, useAuthErrorText, useValidationText } from './parts';

type Form = z.input<typeof codeFormSchema>;
type Values = z.output<typeof codeFormSchema>;

/**
 * "Revisa tu correo": el enlace del correo abre la app por `auth/callback`; si no, el código de 6
 * dígitos. Reenviar espera 60 segundos, igual que Supabase.
 */
export function CheckEmailScreen() {
  const params = useLocalSearchParams<{ flow?: string; email?: string }>();
  const parsed = checkEmailParamsSchema.safeParse(params);
  if (!parsed.success) {
    return <Redirect href="/welcome" />;
  }
  return <CheckEmail flow={parsed.data.flow} email={parsed.data.email} />;
}

function CheckEmail({ flow, email }: { flow: EmailFlow; email: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { service, signIn } = useAuth();
  const validation = useValidationText();
  const errorText = useAuthErrorText();
  const cooldown = useResendCooldown();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Form, unknown, Values>({
    resolver: zodResolver(codeFormSchema),
    defaultValues: { code: '' },
  });

  const submit = handleSubmit(async ({ code }) => {
    setSubmitError(null);
    try {
      const session = await service.verifyCode(email, code, flow);
      // Con la sesión, las rutas protegidas llevan a la app o a elegir la contraseña nueva.
      signIn(session, { recovery: flow === 'recovery' });
    } catch (error) {
      setSubmitError(errorText(error));
    }
  });

  const resend = async () => {
    setSubmitError(null);
    setNotice(null);
    try {
      await service.resend(email, flow);
      cooldown.restart();
      setNotice(t('auth.checkEmail.resent'));
    } catch (error) {
      setSubmitError(errorText(error));
    }
  };

  return (
    <AuthScreen
      title={t('auth.checkEmail.title')}
      description={
        flow === 'signup'
          ? t('auth.checkEmail.signupBody', { email })
          : t('auth.checkEmail.recoveryBody', { email })
      }
      testID="check-email-screen"
    >
      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            testID="check-email-code"
            label={t('auth.fields.code')}
            value={field.value}
            onChangeText={(text) => field.onChange(text.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={validation(fieldState.error?.message)}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
          />
        )}
      />
      <FormError message={submitError} />
      {notice ? (
        <Text tone="positive" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <Button
        testID="check-email-submit"
        label={t('auth.checkEmail.submit')}
        onPress={submit}
        loading={formState.isSubmitting}
        fullWidth
      />
      <Button
        testID="check-email-resend"
        label={
          cooldown.ready
            ? t('auth.checkEmail.resend')
            : t('auth.checkEmail.resendIn', { seconds: cooldown.remaining })
        }
        variant="secondary"
        disabled={!cooldown.ready}
        onPress={resend}
        fullWidth
      />
      <Button
        label={t('auth.checkEmail.otherEmail')}
        variant="ghost"
        onPress={() => router.replace(flow === 'signup' ? '/sign-up' : '/forgot-password')}
        fullWidth
      />
    </AuthScreen>
  );
}
