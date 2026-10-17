import { useLocalSearchParams } from 'expo-router';
import { Link2Off, MailCheck, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { z } from 'zod';

import { EmptyState, Screen, Text, useAppTheme } from '@/ui';

import type { EmailFlow, PendingEmailFlow } from '../auth-service';
import { useAuth } from '../AuthProvider';
import { useGuardedRouter } from '@/features/navigation/use-guarded-router';

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
 * sigue a la app o a elegir la contraseña nueva. Si el enlace no abre la sesión, explica qué hacer.
 */
export function AuthCallbackScreen() {
  const { t } = useTranslation();
  const router = useGuardedRouter();
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

  if (!code) {
    return <LinkProblem kind="rejected" />;
  }
  if (result === 'failed') {
    return <LinkProblem kind="notExchanged" />;
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

/**
 * Por qué el enlace no abrió la sesión. `rejected`: Supabase lo rechazó (ya se usó o pasaron los
 * 30 minutos). `notExchanged`: Supabase lo aceptó, y con eso el correo del registro ya quedó
 * confirmado, pero el código no se canjeó: pasaron más de 5 minutos desde que se pidió el correo,
 * o se pidió en otro teléfono.
 */
type ProblemKind = 'rejected' | 'notExchanged';
type ProblemAction = 'signIn' | 'newLink' | 'back';
type ProblemBody = 'confirmedBody' | 'signupBody' | 'recoveryBody' | 'unknownBody' | 'signedInBody';

interface ProblemView {
  readonly icon: LucideIcon;
  readonly title: `auth.callback.${'unusableTitle' | 'confirmedTitle'}`;
  readonly body: `auth.callback.${ProblemBody}`;
  readonly actions: readonly [ProblemAction, ProblemAction?];
}

/** Qué decir según el problema y el último correo pedido en este teléfono (si se sabe). */
function describeProblem(kind: ProblemKind, flow: EmailFlow | 'signedIn' | null): ProblemView {
  const unusable = { icon: Link2Off, title: 'auth.callback.unusableTitle' } as const;
  switch (flow) {
    case 'signedIn':
      return { ...unusable, body: 'auth.callback.signedInBody', actions: ['back'] };
    case 'signup':
      return kind === 'notExchanged'
        ? {
            icon: MailCheck,
            title: 'auth.callback.confirmedTitle',
            body: 'auth.callback.confirmedBody',
            actions: ['signIn'],
          }
        : { ...unusable, body: 'auth.callback.signupBody', actions: ['signIn'] };
    case 'recovery':
      return { ...unusable, body: 'auth.callback.recoveryBody', actions: ['newLink'] };
    default:
      return { ...unusable, body: 'auth.callback.unknownBody', actions: ['signIn', 'newLink'] };
  }
}

function LinkProblem({ kind }: { kind: ProblemKind }) {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  const { state, service } = useAuth();
  // `undefined` mientras se lee del teléfono: es un instante.
  const [pending, setPending] = useState<PendingEmailFlow | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    service.pendingEmailFlow().then(
      (value) => active && setPending(value),
      () => active && setPending(null),
    );
    return () => {
      active = false;
    };
  }, [service]);

  if (pending === undefined) {
    return null;
  }
  const view = describeProblem(
    kind,
    state.status === 'signedIn' ? 'signedIn' : (pending?.flow ?? null),
  );
  // El correo del último pedido ya va escrito en la pantalla siguiente.
  const params = pending ? { email: pending.email } : {};
  const actions: Record<ProblemAction, { label: string; onPress: () => void }> = {
    signIn: {
      label: t('auth.callback.signIn'),
      onPress: () => router.replace({ pathname: '/sign-in', params }),
    },
    newLink: {
      label: t('auth.callback.newLink'),
      onPress: () => router.replace({ pathname: '/forgot-password', params }),
    },
    back: { label: t('auth.callback.back'), onPress: () => router.replace('/') },
  };
  const [primary, secondary] = view.actions;

  return (
    <Screen edges={['top', 'bottom']} testID="auth-callback-problem">
      <EmptyState
        icon={view.icon}
        title={t(view.title)}
        description={t(view.body)}
        action={actions[primary]}
        secondaryAction={secondary ? actions[secondary] : undefined}
      />
    </Screen>
  );
}
