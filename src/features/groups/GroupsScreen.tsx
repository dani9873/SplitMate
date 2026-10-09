import { Users } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/ui';

/** Lista de grupos. En la Fase 0 solo muestra el estado vacío. */
export function GroupsScreen() {
  const { t } = useTranslation();
  return (
    <Screen title={t('groups.title')}>
      <EmptyState
        icon={Users}
        title={t('groups.empty.title')}
        description={t('groups.empty.description')}
      />
    </Screen>
  );
}
