import type { LucideIcon } from 'lucide-react-native';
import { Pressable, type PressableProps } from 'react-native';

import { cn } from './cn';
import { usePressGuard } from './press-guard';
import { useAppTheme, type ColorToken } from './theme';

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  icon: LucideIcon;
  /** Nombre accesible, ya traducido: el ícono solo no dice qué hace. */
  label: string;
  tone?: Extract<ColorToken, 'fg' | 'fgMuted' | 'primary' | 'negative'>;
  /**
   * Desactiva la protección contra toques repetidos. Solo para controles que se tocan varias veces
   * a propósito (sumar y restar, cambiar de mes).
   */
  repeatable?: boolean;
  className?: string;
}

/**
 * Botón de solo ícono con área táctil de 44 × 44 y nombre accesible. Ignora toques repetidos
 * (`usePressGuard`)
 * salvo con `repeatable`.
 */
export function IconButton({
  icon: Icon,
  label,
  tone = 'fg',
  disabled,
  className,
  repeatable = false,
  onPress,
  ...props
}: IconButtonProps) {
  const { colors } = useAppTheme();
  const guardedPress = usePressGuard(onPress);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={repeatable ? onPress : guardedPress}
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
