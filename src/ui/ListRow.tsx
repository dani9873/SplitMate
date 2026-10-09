import type { ReactNode } from 'react';
import { Pressable, View, type PressableProps } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';

export interface ListRowProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Frase completa para el lector de pantalla: la fila se lee como un solo elemento. */
  accessibilityLabel: string;
  className?: string;
}

/** Fila tocable de una lista: ícono, título, detalle y un valor al final. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  className,
  ...props
}: ListRowProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessible
      onPress={onPress}
      disabled={!onPress}
      className={cn(
        'min-h-[64px] flex-row items-center gap-3 px-4 py-3',
        onPress && 'active:bg-surface-muted',
        className,
      )}
      {...props}
    >
      {leading}
      <View className="flex-1 gap-0.5">
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}
