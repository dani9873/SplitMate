import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { ActivityItem } from '@/db/repositories';
import { useFormatters } from '@/i18n';
import { Text, useAppTheme } from '@/ui';

import { CategoryIcon } from '../categories';

export interface ActivityRowProps {
  item: ActivityItem;
  /** Miembro que es "yo" en el grupo de la fila, para mostrar tu parte. */
  meId: string | null;
  /** Ícono guardado de la categoría del movimiento. */
  categoryIcon: string | null;
  /** En la pestaña global, cada fila dice de qué grupo es. */
  showGroup: boolean;
  onOpen: (item: ActivityItem) => void;
}

/**
 * Fila del historial: qué fue, quién pagó, tu parte y el monto en su propia moneda. Se lee
 * como una frase completa en el lector de pantalla.
 */
export const ActivityRow = memo(function ActivityRow({
  item,
  meId,
  categoryIcon,
  showGroup,
  onOpen,
}: ActivityRowProps) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { colors } = useAppTheme();

  let title: string;
  let detail: string;
  if (item.kind === 'transfer') {
    title = t('activity.transfer', { from: item.from.name, to: item.to.name });
    detail = '';
  } else {
    title = item.title;
    const [onlyPayer] = item.payers;
    detail =
      item.payers.length === 1 && onlyPayer
        ? t(item.kind === 'expense' ? 'activity.paidBy' : 'activity.receivedBy', {
            name: onlyPayer.name,
          })
        : t(item.kind === 'expense' ? 'activity.paidByMany' : 'activity.receivedByMany', {
            count: item.payers.length,
          });
    const mine = meId ? item.splits.find((s) => s.memberId === meId) : undefined;
    if (mine && mine.amount.amount > 0) {
      detail += ` · ${t('activity.yourShare', { amount: money(mine.amount) })}`;
    }
  }
  if (showGroup) {
    detail = detail ? `${item.groupName} · ${detail}` : item.groupName;
  }
  const amount = money(item.amount);
  const converted = item.amount.currency !== item.groupAmount.currency;

  return (
    <Pressable
      testID={`activity-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={t('activity.rowA11y', { title, amount, detail })}
      onPress={() => onOpen(item)}
      className="min-h-[68px] flex-row items-center gap-3 py-2 active:bg-surface-muted"
    >
      <View className="h-11 w-11 items-center justify-center rounded-xl bg-surface-muted">
        <CategoryIcon
          name={item.kind === 'transfer' ? 'transfer' : categoryIcon}
          size={20}
          color={item.kind === 'income' ? colors.positive : colors.fgMuted}
        />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View className="items-end gap-0.5">
        <Text variant="bodyStrong" tabular tone={item.kind === 'income' ? 'positive' : 'default'}>
          {amount}
        </Text>
        {converted ? (
          <Text variant="caption" tone="muted" tabular>
            {money(item.groupAmount)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});
