import { ArrowDownLeft, ArrowUpRight, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { Money } from '@/domain';
import { useFormatters } from '@/i18n';
import { cn, Text, useAppTheme, type TextVariant } from '@/ui';

import { balanceDirection, balanceSentence } from './balance-status';

export interface BalanceTextProps {
  amount: Money;
  perspective: 'you' | 'member';
  variant?: TextVariant;
  className?: string;
}

/**
 * Saldo con flecha, color y palabras. Quien no distingue el verde del rojo lo entiende por
 * el texto y la flecha.
 */
export function BalanceText({
  amount,
  perspective,
  variant = 'label',
  className,
}: BalanceTextProps) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const { colors } = useAppTheme();
  const direction = balanceDirection(amount);
  const Icon = direction === 'owed' ? ArrowUpRight : direction === 'owes' ? ArrowDownLeft : Check;
  const tone = direction === 'owed' ? 'positive' : direction === 'owes' ? 'negative' : 'muted';
  return (
    <View className={cn('flex-row items-center gap-1', className)}>
      <Icon
        size={16}
        strokeWidth={2.6}
        color={
          direction === 'owed'
            ? colors.positive
            : direction === 'owes'
              ? colors.negative
              : colors.fgMuted
        }
      />
      <Text variant={variant} tone={tone} tabular numberOfLines={1}>
        {balanceSentence(amount, perspective, money, t)}
      </Text>
    </View>
  );
}
