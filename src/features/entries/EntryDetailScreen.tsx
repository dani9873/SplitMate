import { useRouter } from 'expo-router';
import { FileQuestion, Pencil, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ALL_TABLES } from '@/db/changes';
import { useDatabase } from '@/db/DatabaseProvider';
import type { ActivityItem, ActivityShare, Repositories } from '@/db/repositories';
import { useLiveQuery } from '@/db/use-live-query';
import { useFormatters } from '@/i18n';
import {
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  LoadingState,
  MemberAvatar,
  Screen,
  Text,
  useAppTheme,
} from '@/ui';

import { CategoryIcon, useCategoryLabel } from '../categories';
import { describeError } from '../errors/describe-error';
import { ScreenHeader, useRouteId } from '../navigation';
import { useUndo } from '../undo';

interface DetailData {
  readonly item: ActivityItem;
  readonly archived: boolean;
  readonly category: { key: string | null; name: string | null; icon: string } | null;
}

function readDetail(repos: Repositories, groupId: string, entryId: string): DetailData | null {
  const group = repos.groups.get(groupId);
  const item = repos.activity.list({ groupId }).find((entry) => entry.id === entryId);
  if (!group || !item) {
    return null;
  }
  const category =
    item.kind === 'transfer' || !item.categoryId
      ? null
      : (repos.categories.list().find((c) => c.id === item.categoryId) ?? null);
  return { item, archived: group.archivedAt !== null, category };
}

/** Detalle de un movimiento: quién pagó, cómo se dividió y la tasa si hubo conversión. */
export function EntryDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const groupId = useRouteId('groupId');
  const entryId = useRouteId('entryId');
  const query = useLiveQuery(
    (repos) => (groupId && entryId ? readDetail(repos, groupId, entryId) : null),
    { tables: ALL_TABLES, groupId: groupId ?? undefined },
    [groupId, entryId],
  );

  return (
    <Screen scroll edges={['top', 'bottom']} testID="entry-detail-screen">
      {query.status === 'loading' ? (
        <>
          <ScreenHeader title="" />
          <LoadingState rows={3} />
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
            icon={FileQuestion}
            title={t('common.notFound.title')}
            description={t('common.notFound.description')}
            action={{ label: t('common.notFound.action'), onPress: () => router.replace('/') }}
          />
        </>
      ) : (
        <DetailContent data={query.data} />
      )}
    </Screen>
  );
}

function DetailContent({ data }: { data: DetailData }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { repos } = useDatabase();
  const { offerUndo } = useUndo();
  const { money, day } = useFormatters();
  const { colors } = useAppTheme();
  const categoryLabel = useCategoryLabel();
  const { item, archived, category } = data;
  const converted = item.amount.currency !== item.groupAmount.currency;
  const title =
    item.kind === 'transfer'
      ? t('activity.transfer', { from: item.from.name, to: item.to.name })
      : item.title;

  const remove = () => {
    const kind = item.kind;
    try {
      if (kind === 'transfer') {
        repos.transfers.remove(item.id, item.version);
      } else {
        repos.expenses.remove(item.id, item.version);
      }
    } catch (error) {
      offerUndo({ message: describeError(error, t), undo: () => {} });
      return;
    }
    // El borrado sube la versión en uno; restaurar la espera.
    const removedVersion = item.version + 1;
    offerUndo({
      message: t(`entries.detail.deleted.${kind}`),
      undo: () =>
        kind === 'transfer'
          ? repos.transfers.restore(item.id, removedVersion)
          : repos.expenses.restore(item.id, removedVersion),
    });
    router.back();
  };

  return (
    <>
      <ScreenHeader title={title} />
      <View className="items-center gap-2 py-2">
        <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft">
          <CategoryIcon
            name={item.kind === 'transfer' ? 'transfer' : category?.icon}
            size={28}
            color={colors.primary}
          />
        </View>
        <Text variant="display" tabular accessibilityRole="text" testID="entry-amount">
          {money(item.amount)}
        </Text>
        {converted ? (
          <Text tone="muted" tabular>
            {money(item.groupAmount)}
          </Text>
        ) : null}
        <Text tone="muted">{day(item.occurredOn, 'long')}</Text>
        {category ? (
          <Text variant="label" tone="muted">
            {categoryLabel(category)}
          </Text>
        ) : null}
      </View>

      {item.kind === 'transfer' ? (
        <Card padded={false}>
          <PartyRow label={t('entries.detail.from')} name={item.from.name} />
          <PartyRow label={t('entries.detail.to')} name={item.to.name} divider />
        </Card>
      ) : (
        <>
          <SharesCard
            title={
              item.kind === 'expense' ? t('entries.detail.paidBy') : t('entries.detail.receivedBy')
            }
            shares={item.payers}
          />
          <SharesCard
            title={
              item.kind === 'expense' ? t('entries.detail.splitAmong') : t('entries.detail.for')
            }
            shares={item.splits.filter((s) => s.amount.amount > 0)}
            footer={t('entries.detail.method', {
              method:
                item.splitMethod === 'percentage'
                  ? t('entries.split.methodA11y.percentage')
                  : t(`entries.split.method.${item.splitMethod}`),
            })}
          />
        </>
      )}

      {converted ? (
        <Text variant="caption" tone="muted">
          {t('entries.detail.rate', {
            from: item.amount.currency,
            rate: item.exchangeRate,
            to: item.groupAmount.currency,
          })}
        </Text>
      ) : null}

      {archived ? null : (
        <View className="flex-row gap-3">
          <Button
            testID="edit-entry"
            label={t('entries.detail.edit')}
            icon={Pencil}
            variant="secondary"
            className="flex-1"
            onPress={() => router.push(`/groups/${item.groupId}/entries/${item.id}/edit`)}
          />
          <Button
            testID="delete-entry"
            label={t('entries.detail.delete')}
            icon={Trash2}
            variant="danger"
            className="flex-1"
            onPress={remove}
          />
        </View>
      )}
    </>
  );
}

function PartyRow({
  label,
  name,
  divider = false,
}: {
  label: string;
  name: string;
  divider?: boolean;
}) {
  return (
    <View
      accessible
      className={cn(
        'min-h-[56px] flex-row items-center gap-3 px-4',
        divider && 'border-t border-line',
      )}
    >
      <Text variant="label" tone="muted" className="w-16">
        {label}
      </Text>
      <MemberAvatar name={name} />
      <Text variant="bodyStrong" className="flex-1">
        {name}
      </Text>
    </View>
  );
}

function SharesCard({
  title,
  shares,
  footer,
}: {
  title: string;
  shares: readonly ActivityShare[];
  footer?: string;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  return (
    <View className="gap-2">
      <Text variant="label" tone="muted" accessibilityRole="header">
        {title}
      </Text>
      <Card padded={false}>
        {shares.map((share, index) => {
          const name = share.removed ? t('common.removedSuffix', { name: share.name }) : share.name;
          return (
            <View
              key={share.memberId}
              accessible
              className={cn(
                'min-h-[52px] flex-row items-center gap-3 px-4',
                index > 0 && 'border-t border-line',
              )}
            >
              <MemberAvatar name={share.name} />
              <Text className="flex-1" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="bodyStrong" tabular>
                {money(share.amount)}
              </Text>
            </View>
          );
        })}
      </Card>
      {footer ? (
        <Text variant="caption" tone="muted">
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
