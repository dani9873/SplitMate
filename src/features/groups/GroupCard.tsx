import { ChevronRight } from 'lucide-react-native';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { GroupSummary } from '@/db/repositories';
import { useFormatters } from '@/i18n';
import type { GroupColor } from '@/lib/group-appearance';
import { GroupAvatar, Text, useAppTheme } from '@/ui';

import { balanceSentence, BalanceText } from '../balances';

export interface GroupCardProps {
  summary: GroupSummary;
  onOpen: (groupId: string) => void;
}

/** Tarjeta de un grupo en la lista: ícono, nombre, miembros y tu saldo en su moneda. */
export const GroupCard = memo(function GroupCard({ summary, onOpen }: GroupCardProps) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { colors } = useAppTheme();
  const { group, memberCount, myBalance } = summary;
  const members = t('groups.memberCount', { count: memberCount });
  const archived = group.archivedAt !== null;
  const balance = myBalance ? balanceSentence(myBalance, 'you', money, t) : t('groups.chooseMe');
  const label = t('groups.cardA11y', { name: group.name, members, balance });

  return (
    <Pressable
      testID={`group-card-${group.id}`}
      accessibilityRole="button"
      accessibilityLabel={archived ? `${label}, ${t('groups.archivedBadge')}` : label}
      onPress={() => onOpen(group.id)}
      className="mb-3 flex-row items-center gap-3 rounded-xl border border-line bg-surface p-4 active:bg-surface-muted"
    >
      <GroupAvatar name={group.name} emoji={group.emoji} color={group.color as GroupColor} />
      <View className="flex-1 gap-1">
        <Text variant="bodyStrong" numberOfLines={1}>
          {group.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {archived
            ? `${members} · ${group.currency} · ${t('groups.archivedBadge')}`
            : `${members} · ${group.currency}`}
        </Text>
        {myBalance ? (
          <BalanceText amount={myBalance} perspective="you" />
        ) : (
          <Text variant="label" tone="primary">
            {t('groups.chooseMe')}
          </Text>
        )}
      </View>
      <ChevronRight size={20} color={colors.fgMuted} />
    </Pressable>
  );
});
