import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Plus, Users } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ALL_TABLES } from '@/db/changes';
import type { GroupSummary } from '@/db/repositories';
import { useLiveQuery } from '@/db/use-live-query';
import { EmptyState, ErrorState, IconButton, LoadingState, Screen, Text, useAppTheme } from '@/ui';

import { GroupCard } from './GroupCard';

type Row =
  | { readonly type: 'group'; readonly summary: GroupSummary }
  | { readonly type: 'archived-toggle'; readonly count: number; readonly expanded: boolean };

/** Lista de grupos con tu saldo en cada uno. Los archivados quedan plegados al final. */
export function GroupsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const query = useLiveQuery((repos) => repos.groups.listSummaries(), { tables: ALL_TABLES });

  const openGroup = useCallback((groupId: string) => router.push(`/groups/${groupId}`), [router]);
  const createGroup = useCallback(() => router.push('/groups/new'), [router]);

  const rows = useMemo<Row[]>(() => {
    if (query.status !== 'ready') {
      return [];
    }
    const active = query.data.filter((s) => s.group.archivedAt === null);
    const archived = query.data.filter((s) => s.group.archivedAt !== null);
    return [
      ...active.map((summary) => ({ type: 'group' as const, summary })),
      ...(archived.length > 0
        ? [{ type: 'archived-toggle' as const, count: archived.length, expanded: showArchived }]
        : []),
      ...(showArchived ? archived.map((summary) => ({ type: 'group' as const, summary })) : []),
    ];
  }, [query, showArchived]);

  return (
    <Screen testID="groups-screen">
      <View className="flex-row items-center pb-2 pt-4">
        <Text variant="title" className="flex-1">
          {t('groups.title')}
        </Text>
        <IconButton
          testID="new-group"
          icon={Plus}
          label={t('groups.new')}
          tone="primary"
          onPress={createGroup}
        />
      </View>
      {query.status === 'loading' ? (
        <LoadingState />
      ) : query.status === 'error' ? (
        <ErrorState onRetry={query.retry} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('groups.empty.title')}
          description={t('groups.empty.description')}
          action={{ label: t('groups.empty.action'), onPress: createGroup }}
        />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(row) => (row.type === 'group' ? row.summary.group.id : 'archived')}
          getItemType={(row) => row.type}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
          // Un grupo nuevo aparece arriba y debe verse, no quedar fuera de la vista.
          maintainVisibleContentPosition={{ disabled: true }}
          renderItem={({ item }) =>
            item.type === 'group' ? (
              <GroupCard summary={item.summary} onOpen={openGroup} />
            ) : (
              <ArchivedToggle
                count={item.count}
                expanded={item.expanded}
                onToggle={() => setShowArchived((value) => !value)}
              />
            )
          }
        />
      )}
    </Screen>
  );
}

function ArchivedToggle({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('groups.archived', { count })}
      accessibilityState={{ expanded }}
      onPress={onToggle}
      className="mb-3 min-h-[48px] flex-row items-center gap-2 rounded-lg px-1 active:bg-surface-muted"
    >
      <Text variant="label" tone="muted" className="flex-1">
        {t('groups.archived', { count })}
      </Text>
      <Icon size={20} color={colors.fgMuted} />
    </Pressable>
  );
}
