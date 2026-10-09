import { ReceiptText } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/ui';

/** Actividad reciente de todos los grupos. En la Fase 0 solo muestra el estado vacío. */
export function ActivityScreen() {
  const { t } = useTranslation();
  return (
    <Screen title={t('activity.title')}>
      <EmptyState
        icon={ReceiptText}
        title={t('activity.empty.title')}
        description={t('activity.empty.description')}
      />
    </Screen>
  );
}
