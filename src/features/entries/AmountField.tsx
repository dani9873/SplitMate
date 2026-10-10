import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { evaluateAmount, zero } from '@/domain';
import { useFormatters } from '@/i18n';
import { cn, Text } from '@/ui';

import { displayExpression, hasOperator } from './keypad-input';

export interface AmountFieldProps {
  expression: string;
  currency: string;
  active: boolean;
  onActivate: () => void;
  /** Nombre accesible del campo, ya traducido: "Monto" o "Monto de Beto". */
  label: string;
  /** Mensaje del problema, ya traducido, para mostrar debajo. */
  error?: string;
  size?: 'hero' | 'compact';
  testID?: string;
}

/**
 * Campo de monto con calculadora: muestra la operación y su resultado con el formato del
 * idioma. Al tocarlo se abre el teclado propio de la pantalla.
 */
export const AmountField = memo(function AmountField({
  expression,
  currency,
  active,
  onActivate,
  label,
  error,
  size = 'hero',
  testID,
}: AmountFieldProps) {
  const { t } = useTranslation();
  const { money: formatMoney, decimalSeparator } = useFormatters();
  const result = expression ? evaluateAmount(expression, currency) : null;
  const formatted = result?.ok ? formatMoney(result.value) : null;
  const shown = formatted ?? (expression ? displayExpression(expression, decimalSeparator) : '');
  const a11yLabel = formatted
    ? t('entries.amount.a11y', { amount: formatted })
    : expression
      ? t('entries.amount.a11y', { amount: displayExpression(expression, decimalSeparator) })
      : t('entries.amount.a11yEmpty');

  if (size === 'compact') {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${a11yLabel}`}
        accessibilityHint={t('entries.amount.hint')}
        accessibilityState={{ selected: active }}
        onPress={onActivate}
        className={cn(
          'min-h-[44px] min-w-[96px] items-end justify-center rounded-md border-[1.5px] bg-surface px-3',
          error ? 'border-negative' : active ? 'border-primary' : 'border-line-strong',
        )}
      >
        <Text variant="bodyStrong" tabular numberOfLines={1} tone={shown ? 'default' : 'subtle'}>
          {shown || '—'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View className="gap-1">
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={t('entries.amount.hint')}
        accessibilityState={{ selected: active }}
        onPress={onActivate}
        className="gap-1 py-2"
      >
        {/* Con un resultado válido, la operación va arriba en pequeño; si no, la cifra grande
            ya muestra la operación y no se repite. */}
        {formatted && hasOperator(expression) ? (
          <Text tone="muted" tabular numberOfLines={1}>
            {displayExpression(expression, decimalSeparator)}
          </Text>
        ) : null}
        <Text
          variant="display"
          tabular
          numberOfLines={1}
          adjustsFontSizeToFit
          tone={formatted ? 'default' : 'subtle'}
        >
          {formatted ?? (shown || formatMoney(zero(currency)))}
        </Text>
        <View className={cn('h-0.5 rounded-full', active ? 'bg-primary' : 'bg-line')} />
      </Pressable>
      {error ? (
        <Text
          variant="caption"
          tone="negative"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
});
