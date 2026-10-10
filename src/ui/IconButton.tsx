import type { LucideIcon } from 'lucide-react-native';
import { Pressable, type PressableProps } from 'react-native';

import { cn } from './cn';
import { useAppTheme, type ColorToken } from './theme';

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  icon: LucideIcon;
  /** Nombre accesible, ya traducido: el ícono solo no dice qué hace. */
  label: string;
  tone?: Extract<ColorToken, 'fg' | 'fgMuted' | 'primary' | 'negative'>;
  className?: string;
}

/** Botón de solo ícono con área táctil de 44 × 44 y nombre accesible. */
export function IconButton({
  icon: Icon,
  label,
  tone = 'fg',
  disabled,
  className,
  ...props
}: IconButtonProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={4}
      className={cn(
        'h-11 w-11 items-center justify-center rounded-full active:bg-surface-muted',
        disabled && 'opacity-40',
        className,
      )}
      {...props}
    >
      <Icon size={22} color={colors[tone]} strokeWidth={2.2} />
    </Pressable>
  );
}
