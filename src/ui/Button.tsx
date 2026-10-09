import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';

import { cn } from './cn';
import { Text, type TextTone } from './Text';
import { useAppTheme, type ColorToken } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

const containerClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary active:bg-primary-pressed',
  secondary: 'border border-line-strong bg-surface active:bg-surface-muted',
  ghost: 'bg-transparent active:bg-primary-soft',
  danger: 'bg-danger active:opacity-80',
};

const contentColor: Record<ButtonVariant, ColorToken> = {
  primary: 'onPrimary',
  secondary: 'fg',
  ghost: 'primary',
  danger: 'onDanger',
};

const labelTone: Record<ButtonVariant, TextTone> = {
  primary: 'onPrimary',
  secondary: 'default',
  ghost: 'primary',
  danger: 'onDanger',
};

const sizeClasses: Record<ButtonSize, string> = {
  md: 'min-h-[52px] rounded-lg px-5',
  sm: 'min-h-[40px] rounded-md px-4',
};

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Texto visible, ya traducido. También es el nombre accesible. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Muestra un indicador, bloquea la pulsación y anuncia el estado ocupado. */
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  className,
  ...props
}: ButtonProps) {
  const { colors } = useAppTheme();
  const isDisabled = Boolean(disabled) || loading;
  const color = colors[contentColor[variant]];
  const iconSize = size === 'sm' ? 16 : 20;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      hitSlop={size === 'sm' ? 6 : undefined}
      className={cn(
        'flex-row items-center justify-center gap-2',
        sizeClasses[size],
        containerClasses[variant],
        fullWidth && 'w-full',
        isDisabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : Icon ? (
        <Icon size={iconSize} color={color} strokeWidth={2.2} />
      ) : null}
      <Text variant={size === 'sm' ? 'label' : 'bodyStrong'} tone={labelTone[variant]}>
        {label}
      </Text>
    </Pressable>
  );
}
