import { useRouter } from 'expo-router';
import {
  Archive,
  ArchiveRestore,
  Compass,
  Plus,
  ReceiptText,
  Settings,
  UserRound,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ALL_TABLES } from '@/db/changes';
import { useDatabase } from '@/db/DatabaseProvider';
import type { ActivityItem, Group, Repositories } from '@/db/repositories';
import { useLiveQuery } from '@/db/use-live-query';
import { zero, type Money } from '@/domain';
import type { GroupColor } from '@/lib/group-appearance';
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  GroupAvatar,
  IconButton,
  LoadingState,
  SegmentedControl,
  Text,
} from '@/ui';

import { ActivityFeed, type FeedMember } from '../activity';
import { BalancesView, BalanceText } from '../balances';
import { describeError } from '../errors/describe-error';
import { ScreenHeader, useRouteId } from '../navigation';
import { useUndo } from '../undo';

type Section = 'activity' | 'balances';

interface DetailData {
  readonly group: Group;
  readonly meId: string | null;
  readonly myBalance: Money | null;
  readonly members: readonly FeedMember[];
  readonly activeMemberCount: number;
  readonly items: readonly ActivityItem[];
}

function readGroup(repos: Repositories, groupId: string): DetailData | null {
  const group = repos.groups.get(groupId);
  if (!group) {
    return null;
  }
  const localUserId = repos.profile.get()?.id ?? null;
  const all = repos.members.listAll(groupId);
  const me = all.find((m) => m.deletedAt === null && m.userId !== null && m.userId === localUserId);
  const balance = me
    ? repos.balances.forGroup(groupId).balances.find((b) => b.memberId === me.id)?.amount
    : undefined;
  return {
    group,
    meId: me?.id ?? null,
    myBalance: me ? (balance ?? zero(group.currency)) : null,
    members: all.map((m) => ({ id: m.id, label: m.displayName })),
    activeMemberCount: all.filter((m) => m.deletedAt === null).length,
    items: repos.activity.list({ groupId }),
  };
}

/** Un grupo: tu saldo, el historial con filtros o los saldos de todos, y añadir movimientos. */
export function GroupDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const groupId = useRouteId('groupId');
  const query = useLiveQuery(
    (repos) => (groupId ? readGroup(repos, groupId) : null),
    { tables: ALL_TABLES, groupId: groupId ?? undefined },
    [groupId],
  );

  return (
    <View
      className="flex-1 bg-background px-5"
      style={{ paddingTop: insets.top }}
      testID="group-detail-screen"
    >
      {query.status === 'loading' ? (
        <>
          <ScreenHeader title="" />
          <LoadingState />
        </>
      ) : query.status === 'error' ? (
        <>
          <ScreenHeader title="" />
          <ErrorState onRetry={query.retry} />
        </>
      ) : query.data === null ? (
        <>
          <ScreenHeader title={t('common.notFound.title')} />
          <EmptyState
            icon={Compass}
            title={t('common.notFound.title')}
            description={t('common.notFound.description')}
            action={{ label: t('common.notFound.action'), onPress: () => router.replace('/') }}
          />
        </>
      ) : (
        <GroupContent data={query.data} />
      )}
    </View>
  );
}

function GroupContent({ data }: { data: DetailData }) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { repos } = useDatabase();
  const { offerUndo } = useUndo();
  const [section, setSection] = useState<Section>('activity');
  const { group } = data;
  const archived = group.archivedAt !== null;
  const settingsPath = `/groups/${group.id}/settings`;
  const addEntry = () => router.push(`/groups/${group.id}/entries/new`);

  const restore = () => {
    try {
      repos.groups.unarchive(group.id, group.version);
    } catch (error) {
      offerUndo({ message: describeError(error, t), undo: () => {} });
    }
  };

  return (
    <>
      <ScreenHeader
        title={group.name}
        actions={
          <IconButton
            testID="group-settings"
            icon={Settings}
            label={t('groupDetail.settings')}
            onPress={() => router.push(settingsPath)}
          />
        }
      />
      <View className="flex-row items-center gap-3 pb-4">
        <GroupAvatar name={group.name} emoji={group.emoji} color={group.color as GroupColor} />
        <View className="flex-1 gap-0.5">
          {data.myBalance ? (
            <BalanceText amount={data.myBalance} perspective="you" variant="subheading" />
          ) : null}
          <Text variant="caption" tone="muted">
            {t('groups.summaryLine', {
              members: t('groups.memberCount', { count: data.activeMemberCount }),
              currency: group.currency,
            })}
          </Text>
        </View>
      </View>

      {archived ? (
        <Banner
          icon={Archive}
          tone="warning"
          message={t('groupDetail.archived')}
          className="mb-4"
          actions={
            <Button
              label={t('groupDetail.restore')}
              icon={ArchiveRestore}
              size="sm"
              variant="secondary"
              onPress={restore}
            />
          }
        />
      ) : data.meId === null ? (
        <Banner
          icon={UserRound}
          message={t('groupDetail.chooseMe')}
          className="mb-4"
          actions={
            <Button
              label={t('groupDetail.chooseMeAction')}
              size="sm"
              variant="secondary"
              onPress={() => router.push(settingsPath)}
            />
          }
        />
      ) : null}

      <SegmentedControl
        label={t('groupDetail.sections')}
        value={section}
        onChange={setSection}
        className="mb-3"
        segments={[
          { value: 'activity', label: t('groupDetail.activity'), testID: 'section-activity' },
          { value: 'balances', label: t('groupDetail.balances'), testID: 'section-balances' },
        ]}
      />

      <View className="flex-1">
        {section === 'activity' ? (
          <ActivityFeed
            items={data.items}
            meByGroup={new Map(data.meId ? [[group.id, data.meId]] : [])}
            members={data.members}
            showGroup={false}
            bottomInset={insets.bottom + 96}
            empty={
              <EmptyState
                icon={ReceiptText}
                title={t('activity.emptyGroup.title')}
                description={t('activity.emptyGroup.description')}
                action={
                  archived
                    ? undefined
                    : { label: t('activity.emptyGroup.action'), onPress: addEntry }
                }
              />
            }
          />
        ) : (
          <BalancesView groupId={group.id} />
        )}
      </View>

      {archived ? null : (
        <View className="absolute right-5" style={{ bottom: insets.bottom + 16 }}>
          <Button
            testID="add-entry"
            label={t('entries.add')}
            accessibilityLabel={t('entries.addA11y')}
            icon={Plus}
            onPress={addEntry}
            className="rounded-full px-6 shadow-lg"
          />
        </View>
      )}
    </>
  );
}
