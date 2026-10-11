import { useLocalSearchParams, useRouter } from 'expo-router';
import { Link2Off } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { z } from 'zod';

import { EmptyState, Screen, Text, useAppTheme } from '@/ui';

import { useAuth } from '../AuthProvider';

/** Lo que `+native-intent` deja pasar; se vuelve a validar porque la ruta existe siempre. */
const paramsSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  sb_flow_id: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
});

/**
 * Destino de los enlaces de los correos de Supabase: canjea el código del enlace por una sesión y
 * sigue a la app o a elegir la contraseña nueva. Un enlace vencido, usado o con error explica qué
 * hacer.
 */
export function AuthCallbackScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { state, service, signIn } = useAuth();
  const params = useLocalSearchParams<{ code?: string; sb_flow_id?: string }>();
  const [result, setResult] = useState<'done' | 'failed' | null>(null);
  // Un código sirve una sola vez: aunque el efecto corra de nuevo, se canjea una vez.
  const exchanged = useRef<string | null>(null);

  const parsed = paramsSchema.safeParse(params);
  const code = parsed.success ? parsed.data.code : null;
  const flowId = parsed.success ? (parsed.data.sb_flow_id ?? null) : null;

  useEffect(() => {
    if (!code || exchanged.current === code) {
      return;
    }
    exchanged.current = code;
    service.exchangeCode(code, flowId).then(
      ({ session, recovery }) => {
        signIn(session, { recovery });
        setResult('done');
      },
      () => setResult('failed'),
    );
  }, [code, flowId, service, signIn]);

  // Ya con la sesión, las rutas protegidas cambiaron: a la app o a la contraseña nueva.
  useEffect(() => {
    if (result === 'done' && state.status === 'signedIn') {
      router.replace(state.recovering ? '/reset-password' : '/');
    }
  }, [result, state, router]);

  if (!code || result === 'failed') {
    return (
      <Screen edges={['top', 'bottom']} testID="auth-callback-error">
        <EmptyState
          icon={Link2Off}
          title={t('auth.callback.errorTitle')}
          description={t('auth.callback.errorBody')}
          action={{
            label: t('auth.callback.back'),
            // Sin sesión, `/` está protegida: la bienvenida.
            onPress: () => router.replace(state.status === 'signedIn' ? '/' : '/welcome'),
          }}
        />
      </Screen>
    );
  }
  return (
    <Screen edges={['top', 'bottom']} testID="auth-callback-loading">
      <View className="flex-1 items-center justify-center gap-3">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text tone="muted">{t('auth.callback.loading')}</Text>
      </View>
    </Screen>
  );
}
