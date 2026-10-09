import { Minus, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cn } from './cn';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  /** Qué se ajusta, para los nombres accesibles: "partes de Beto". */
  label: string;
  min?: number;
  max?: number;
  className?: string;
}

/**
 * Número entero con botones − y +. Para lectores de pantalla es un control ajustable: se
 * desliza hacia arriba o abajo para cambiarlo.
 */
export function Stepper({ value, onChange, label, min = 0, max = 99, className }: StepperProps) {
  const { t } = useTranslation();
  const change = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        change(event.nativeEvent.actionName === 'increment' ? value + 1 : value - 1)
      }
      className={cn('flex-row items-center', className)}
    >
      <IconButton
        icon={Minus}
        label={t('ui.stepper.decrease', { label })}
        tone="primary"
        disabled={value <= min}
        onPress={() => change(value - 1)}
      />
      <Text variant="bodyStrong" tabular className="min-w-[28px] text-center">
        {String(value)}
      </Text>
      <IconButton
        icon={Plus}
        label={t('ui.stepper.increase', { label })}
        tone="primary"
        disabled={value >= max}
        onPress={() => change(value + 1)}
      />
    </View>
  );
}
