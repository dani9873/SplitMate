import { Check, type LucideIcon } from 'lucide-react-native';
import { Pressable, type PressableProps } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';
import { useAppTheme } from './theme';

export interface ChipProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Texto visible y nombre accesible, ya traducido. */
  label: string;
  selected?: boolean;
  icon?: LucideIcon;
  /** Ícono al final, por ejemplo una flecha para abrir un selector. */
  trailingIcon?: LucideIcon;
  className?: string;
}

/**
 * Opción compacta para filtros y selecciones. Elegida, muestra una marca además del color,
 * así no depende solo del color.
 */
export function Chip({
  label,
  selected = false,
  icon: Icon,
  trailingIcon: Trailing,
  className,
  ...props
}: ChipProps) {
  const { colors } = useAppTheme();
  const color = selected ? colors.primary : colors.fgMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      className={cn(
        'min-h-[44px] flex-row items-center gap-1.5 rounded-full border px-3.5',
        selected
          ? 'border-primary bg-primary-soft'
          : 'border-line-strong bg-surface active:bg-surface-muted',
        className,
      )}
      {...props}
    >
      {selected ? (
        <Check size={16} color={colors.primary} strokeWidth={2.6} />
      ) : Icon ? (
        <Icon size={16} color={color} strokeWidth={2.2} />
      ) : null}
      <Text variant="label" tone={selected ? 'primary' : 'default'} numberOfLines={1}>
        {label}
      </Text>
      {Trailing ? <Trailing size={16} color={color} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}
