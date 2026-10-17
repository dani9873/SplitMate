import { Compass } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/ui';
import { useGuardedRouter } from './use-guarded-router';

/**
 * Ruta inexistente, por ejemplo un enlace viejo o mal escrito. `home` es a dónde volver: sin
 * sesión, `/` está protegida y la app no navegaría.
 */
export function NotFoundScreen({ home = '/' }: { home?: '/' | '/welcome' }) {
  const { t } = useTranslation();
  const router = useGuardedRouter();
  return (
    <Screen edges={['top', 'bottom']}>
      <EmptyState
        icon={Compass}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={{ label: t('notFound.action'), onPress: () => router.replace(home) }}
      />
    </Screen>
  );
}
