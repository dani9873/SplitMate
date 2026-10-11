import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';
import { useAppTheme } from './theme';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto visible y nombre accesible, ya traducido. */
  label: string;
  /** Contenido extra a la derecha, por ejemplo la parte calculada. */
  trailing?: ReactNode;
  disabled?: boolean;
  className?: string;
  testID?: string;
}

/** Casilla con etiqueta; toda la fila es el área táctil. */
export function Checkbox({
  checked,
  onChange,
  label,
  trailing,
  disabled = false,
  className,
  testID,
}: CheckboxProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      className={cn(
        'min-h-[48px] flex-row items-center gap-3',
        disabled && 'opacity-50',
        className,
      )}
    >
      <View
        className={cn(
          'h-6 w-6 items-center justify-center rounded-md border-2',
          checked ? 'border-primary bg-primary' : 'border-line-strong bg-surface',
        )}
      >
        {checked ? <Check size={16} color={colors.onPrimary} strokeWidth={3} /> : null}
      </View>
      <Text className="flex-1" numberOfLines={1}>
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}
