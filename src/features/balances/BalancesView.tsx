import { ArrowRight, CheckCheck, PartyPopper } from 'lucide-react-native';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { ALL_TABLES } from '@/db/changes';
import { useDatabase } from '@/db/DatabaseProvider';
import type { Repositories } from '@/db/repositories';
import { useLiveQuery } from '@/db/use-live-query';
import type { Money, Transfer } from '@/domain';
import { useFormatters } from '@/i18n';
import { today } from '@/lib/calendar-date';
import {
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  LoadingState,
  MemberAvatar,
  Text,
  useAppTheme,
} from '@/ui';

import { describeError } from '../errors/describe-error';
import { useUndo } from '../undo';
import { balanceDirection, balanceSentence } from './balance-status';

interface BalanceRowData {
  readonly memberId: string;
  readonly name: string;
  readonly isMe: boolean;
  readonly removed: boolean;
  readonly amount: Money;
}

interface BalancesData {
  readonly archived: boolean;
  readonly rows: readonly BalanceRowData[];
  readonly settlement: readonly Transfer[];
  readonly names: ReadonlyMap<string, string>;
}

function readBalances(repos: Repositories, groupId: string, you: (name: string) => string) {
  const group = repos.groups.get(groupId);
  if (!group) {
    return null;
  }
  const { balances, settlement } = repos.balances.forGroup(groupId);
  const localUserId = repos.profile.get()?.id ?? null;
  const members = new Map(repos.members.listAll(groupId).map((m) => [m.id, m]));
  const rows = balances
    .map((balance) => {
      const member = members.get(balance.memberId);
      const removed = member?.deletedAt != null;
      const isMe = !removed && member?.userId != null && member.userId === localUserId;
      const name = member?.displayName ?? '';
      return {
        memberId: balance.memberId,
        name: isMe ? you(name) : name,
        isMe,
        removed,
        amount: balance.amount,
      };
    })
    // Los quitados solo aparecen si una edición posterior les dejó saldo.
    .filter((row) => !row.removed || row.amount.amount !== 0)
    .sort((a, b) => Number(b.isMe) - Number(a.isMe));
  const names = new Map(rows.map((row) => [row.memberId, row.name]));
  for (const member of members.values()) {
    if (!names.has(member.id)) {
      names.set(member.id, member.displayName);
    }
  }
  return { archived: group.archivedAt !== null, rows, settlement, names };
}

/** Saldos del grupo con barras desde el centro y las transferencias sugeridas para saldarlo. */
export function BalancesView({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const query = useLiveQuery(
    (repos) => readBalances(repos, groupId, (name) => t('common.youSuffix', { name })),
    { tables: ALL_TABLES, groupId },
    [groupId],
  );
  if (query.status === 'loading') {
    return <LoadingState rows={3} />;
  }
  if (query.status === 'error' || query.data === null) {
    return <ErrorState onRetry={query.retry} />;
  }
  return <BalancesContent groupId={groupId} data={query.data} />;
}

function BalancesContent({ groupId, data }: { groupId: string; data: BalancesData }) {
  const { t } = useTranslation();
  const { repos } = useDatabase();
  const { offerUndo } = useUndo();
  const { money } = useFormatters();
  const max = Math.max(1, ...data.rows.map((row) => Math.abs(row.amount.amount)));
  const allSettled = data.rows.every((row) => row.amount.amount === 0);

  const markPaid = (transfer: Transfer) => {
    const from = data.names.get(transfer.from) ?? '';
    const to = data.names.get(transfer.to) ?? '';
    try {
      const created = repos.transfers.add({
        groupId,
        fromMemberId: transfer.from,
        toMemberId: transfer.to,
        amount: transfer.amount.amount,
        currency: transfer.amount.currency,
        occurredOn: today(),
      });
      offerUndo({
        message: t('balance.paid', { from, to, amount: money(transfer.amount) }),
        undo: () => repos.transfers.remove(created.id, created.version),
      });
    } catch (error) {
      offerUndo({ message: describeError(error, t), undo: () => {} });
    }
  };

  return (
    <ScrollView contentContainerClassName="gap-6 pb-28 pt-2" testID="balances-view">
      <Card padded={false}>
        {data.rows.map((row, index) => (
          <BalanceRow
            key={row.memberId}
            row={row}
            max={max}
            divider={index > 0}
            testID={`balance-${index}`}
          />
        ))}
      </Card>

      {allSettled ? (
        <EmptyState
          icon={PartyPopper}
          title={t('balance.allSettled.title')}
          description={t('balance.allSettled.description')}
          className="flex-none pb-0"
          testID="all-settled"
        />
      ) : (
        <View className="gap-2">
          <Text variant="subheading" accessibilityRole="header">
            {t('balance.suggested')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('balance.suggestedHint')}
          </Text>
          <Card padded={false}>
            {data.settlement.map((transfer, index) => (
              <SettlementRow
                key={`${transfer.from}-${transfer.to}`}
                from={data.names.get(transfer.from) ?? ''}
                to={data.names.get(transfer.to) ?? ''}
                amount={money(transfer.amount)}
                divider={index > 0}
                readOnly={data.archived}
                onMarkPaid={() => markPaid(transfer)}
                testID={`mark-paid-${index}`}
              />
            ))}
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

const BalanceRow = memo(function BalanceRow({
  row,
  max,
  divider,
  testID,
}: {
  row: BalanceRowData;
  max: number;
  divider: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { colors } = useAppTheme();
  const status = balanceSentence(row.amount, 'member', money, t);
  const direction = balanceDirection(row.amount);
  const name = row.removed ? t('common.removedSuffix', { name: row.name }) : row.name;
  // Cada mitad de la pista es un lado: la barra crece desde el centro hacia la derecha si le
  // deben y hacia la izquierda si debe, proporcional al mayor saldo del grupo.
  const width = `${Math.round((Math.abs(row.amount.amount) / max) * 100)}%` as const;

  return (
    <View
      accessible
      accessibilityLabel={t('balance.memberA11y', { name, status })}
      testID={testID}
      className={cn('gap-2 px-4 py-3', divider && 'border-t border-line')}
    >
      <View className="flex-row items-center gap-3">
        <MemberAvatar name={row.name} highlight={row.isMe} />
        <Text variant="bodyStrong" className="flex-1" numberOfLines={1}>
          {name}
        </Text>
        <Text
          variant="label"
          tabular
          tone={direction === 'owed' ? 'positive' : direction === 'owes' ? 'negative' : 'muted'}
        >
          {status}
        </Text>
      </View>
      <View
        className="h-2 flex-row rounded-full bg-surface-muted"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View className="flex-1 flex-row justify-end">
          {direction === 'owes' ? (
            <View
              className="h-2 rounded-l-full"
              style={{ width, backgroundColor: colors.negative }}
            />
          ) : null}
        </View>
        <View className="h-2 w-0.5 bg-line-strong" />
        <View className="flex-1 flex-row">
          {direction === 'owed' ? (
            <View
              className="h-2 rounded-r-full"
              style={{ width, backgroundColor: colors.positive }}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
});

function SettlementRow({
  from,
  to,
  amount,
  divider,
  readOnly,
  onMarkPaid,
  testID,
}: {
  from: string;
  to: string;
  amount: string;
  divider: boolean;
  readOnly: boolean;
  onMarkPaid: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  return (
    <View className={cn('gap-3 px-4 py-3', divider && 'border-t border-line')}>
      <View
        accessible
        accessibilityLabel={t('balance.transferA11y', { from, to, amount })}
        className="flex-row items-center gap-2"
      >
        <Text variant="bodyStrong" numberOfLines={1} className="shrink">
          {from}
        </Text>
        <ArrowRight size={16} color={colors.fgMuted} />
        <Text variant="bodyStrong" numberOfLines={1} className="flex-1">
          {to}
        </Text>
        <Text variant="bodyStrong" tabular>
          {amount}
        </Text>
      </View>
      {readOnly ? null : (
        <Button
          testID={testID}
          label={t('balance.markPaid')}
          accessibilityLabel={t('balance.markPaidA11y', { from, to, amount })}
          icon={CheckCheck}
          size="sm"
          variant="secondary"
          onPress={onMarkPaid}
          className="self-start"
        />
      )}
    </View>
  );
}
