import { Settings2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/ui';

/** El build no tiene las variables de Supabase: se explica en lugar de cerrarse. */
export function ConfigErrorScreen() {
  const { t } = useTranslation();
  return (
    <Screen edges={['top', 'bottom']} testID="config-error-screen">
      <EmptyState
        icon={Settings2}
        title={t('config.error.title')}
        description={t('config.error.description')}
      />
    </Screen>
  );
}
