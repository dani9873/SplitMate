import { Check, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Card, cn, Text, useAppTheme } from '@/ui';

export interface Option<T extends string> {
  value: T;
  /** Textos ya traducidos. */
  label: string;
  hint?: string;
  icon?: LucideIcon;
}

interface OptionGroupProps<T extends string> {
  title: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Grupo de opciones excluyentes, accesible como radio group. */
export function OptionGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: OptionGroupProps<T>) {
  const { colors } = useAppTheme();

  return (
    <View className="gap-2">
      <Text variant="label" tone="muted" accessibilityRole="header" className="px-1">
        {title}
      </Text>
      <Card padded={false} className="overflow-hidden" accessibilityRole="radiogroup">
        {options.map((option, index) => {
          const selected = option.value === value;
          const Icon = option.icon;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.label}
              accessibilityHint={option.hint}
              onPress={() => onChange(option.value)}
              className={cn(
                'min-h-[56px] flex-row items-center gap-3 px-4 py-3 active:bg-surface-muted',
                index > 0 && 'border-t border-line',
              )}
            >
              {Icon ? <Icon size={20} color={selected ? colors.primary : colors.fgMuted} /> : null}
              <View className="flex-1 gap-0.5">
                <Text variant="bodyStrong">{option.label}</Text>
                {option.hint ? (
                  <Text variant="caption" tone="muted">
                    {option.hint}
                  </Text>
                ) : null}
              </View>
              <View
                className={cn(
                  'h-6 w-6 items-center justify-center rounded-full',
                  selected ? 'bg-primary' : 'border-[1.5px] border-line-strong',
                )}
              >
                {selected ? <Check size={14} color={colors.onPrimary} strokeWidth={3} /> : null}
              </View>
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}
