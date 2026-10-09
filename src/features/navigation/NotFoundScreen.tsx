import { useRouter } from 'expo-router';
import { Compass } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/ui';

/** Ruta inexistente, por ejemplo un enlace viejo o mal escrito. */
export function NotFoundScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen edges={['top', 'bottom']}>
      <EmptyState
        icon={Compass}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={{ label: t('notFound.action'), onPress: () => router.replace('/') }}
      />
    </Screen>
  );
}
