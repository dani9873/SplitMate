import { useId, useState, type Ref } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';
import { useAppTheme } from './theme';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /** Etiqueta visible y nombre accesible del campo, ya traducida. */
  label: string;
  /** Ayuda bajo el campo. Se oculta cuando hay error. */
  hint?: string;
  /** Mensaje de error. Marca el borde y se anuncia a los lectores de pantalla. */
  error?: string;
  className?: string;
  ref?: Ref<TextInput>;
}

export function Input({
  label,
  hint,
  error,
  className,
  editable = true,
  onFocus,
  onBlur,
  ref,
  ...props
}: InputProps) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const labelId = `${useId()}-label`;
  const message = error ?? hint;

  return (
    <View className={cn('gap-1.5', className)}>
      <Text nativeID={labelId} variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        accessibilityHint={message}
        accessibilityState={{ disabled: !editable }}
        editable={editable}
        placeholderTextColor={colors.fgSubtle}
        selectionColor={colors.primary}
        cursorColor={colors.primary}
        className={cn(
          'min-h-[52px] rounded-md border-[1.5px] bg-surface px-4 font-sans text-[16px] text-fg',
          error ? 'border-negative' : focused ? 'border-primary' : 'border-line-strong',
          !editable && 'opacity-60',
        )}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...props}
      />
      {error ? (
        <Text
          variant="caption"
          tone="negative"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
