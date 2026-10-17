import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
import { useState, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View, type TextInput } from 'react-native';

import { IconButton, Input, Screen, Text, type InputProps } from '@/ui';

import { AuthError } from '../auth-errors';
import type { AuthValidationError } from '../auth-form';
import { useGuardedRouter } from '@/features/navigation/use-guarded-router';

/**
 * Pantalla de auth: desplazable, con volver y un título. En iOS el contenido sube con el teclado;
 * en Android la ventana se ajusta sola.
 */
export function AuthScreen({
  title,
  description,
  back = true,
  testID,
  children,
}: {
  title: string;
  description?: string;
  back?: boolean;
  testID: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen scroll edges={['top', 'bottom']} testID={testID}>
        {back ? (
          <IconButton
            icon={ArrowLeft}
            label={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
            className="-ml-2"
          />
        ) : null}
        <View className="gap-2">
          <Text variant="title">{title}</Text>
          {description ? <Text tone="muted">{description}</Text> : null}
        </View>
        {children}
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** Contraseña con el botón de mostrarla u ocultarla. */
export function PasswordField({
  ref,
  ...props
}: Omit<InputProps, 'secureTextEntry' | 'trailing'> & { ref?: Ref<TextInput> }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <Input
      ref={ref}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={128}
      trailing={
        <IconButton
          icon={visible ? EyeOff : Eye}
          tone="fgMuted"
          label={visible ? t('auth.fields.hidePassword') : t('auth.fields.showPassword')}
          onPress={() => setVisible((value) => !value)}
        />
      }
      {...props}
    />
  );
}

/** Texto de un error de validación de los formularios de auth. */
export function useValidationText() {
  const { t } = useTranslation();
  return (message?: string) =>
    message ? t(`auth.validation.${message as AuthValidationError}`) : undefined;
}

/** Texto de un error del servicio de auth. Cualquier otro error cuenta como desconocido. */
export function useAuthErrorText() {
  const { t } = useTranslation();
  return (error: unknown) =>
    t(`auth.errors.${error instanceof AuthError ? error.code : 'unknown'}`);
}

/** Mensaje de error del envío del formulario, anunciado a los lectores de pantalla. */
export function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <Text
      tone="negative"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="form-error"
    >
      {message}
    </Text>
  );
}
