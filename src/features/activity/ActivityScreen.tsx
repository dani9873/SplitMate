import { ReceiptText } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { ALL_TABLES } from '@/db/changes';
import { useLiveQuery } from '@/db/use-live-query';
import { EmptyState, ErrorState, LoadingState, Screen } from '@/ui';

import { ActivityFeed } from './ActivityFeed';

/**
 * Actividad de todos los grupos. Cada fila conserva la moneda de su movimiento: aquí nunca
 * se suman ni se comparan montos de grupos distintos.
 */
export function ActivityScreen() {
  const { t } = useTranslation();
  const query = useLiveQuery(
    (repos) => ({
      items: repos.activity.list(),
      meByGroup: new Map(repos.members.listMine().map((m) => [m.groupId, m.id])),
    }),
    { tables: ALL_TABLES },
  );

  return (
    <Screen title={t('activity.title')} testID="activity-screen">
      {query.status === 'loading' ? (
        <LoadingState />
      ) : query.status === 'error' ? (
        <ErrorState onRetry={query.retry} />
      ) : (
        <ActivityFeed
          items={query.data.items}
          meByGroup={query.data.meByGroup}
          showGroup
          empty={
            <EmptyState
              icon={ReceiptText}
              title={t('activity.empty.title')}
              description={t('activity.empty.description')}
            />
          }
        />
      )}
    </Screen>
  );
}
