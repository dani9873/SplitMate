import { Pressable, View } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';

export interface Segment<T extends string> {
  readonly value: T;
  /** Texto visible, ya traducido. */
  readonly label: string;
  /** Nombre para lectores de pantalla si el texto visible es un símbolo, como "%". */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export interface SegmentedControlProps<T extends string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Nombre del grupo para lectores de pantalla, por ejemplo "Tipo de movimiento". */
  label: string;
  className?: string;
}

/** Opciones excluyentes en una barra. Se anuncia como pestañas con la elegida seleccionada. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className={cn('flex-row gap-1 rounded-lg bg-surface-muted p-1', className)}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            testID={segment.testID}
            accessibilityRole="tab"
            accessibilityLabel={segment.accessibilityLabel ?? segment.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(segment.value)}
            className={cn(
              'min-h-[44px] flex-1 items-center justify-center rounded-md px-2',
              selected ? 'border border-line bg-surface' : 'active:bg-surface',
            )}
          >
            <Text
              variant="label"
              tone={selected ? 'default' : 'muted'}
              numberOfLines={1}
              className={selected ? 'font-sans-bold' : undefined}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
