import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as NativeText, View } from 'react-native';

import { GROUP_COLORS, GROUP_EMOJIS, type GroupColor } from '@/lib/group-appearance';
import { cn, groupPalette, initialOf, Text, useAppTheme } from '@/ui';

export interface AppearancePickerProps {
  name: string;
  emoji: string | null;
  color: GroupColor;
  onEmojiChange: (emoji: string | null) => void;
  onColorChange: (color: GroupColor) => void;
}

/**
 * Ícono y color del grupo. Cada opción es un botón de radio: la elegida se marca con un
 * borde y una marca, no solo con el color.
 */
export function AppearancePicker({
  name,
  emoji,
  color,
  onEmojiChange,
  onColorChange,
}: AppearancePickerProps) {
  const { t } = useTranslation();
  const { scheme } = useAppTheme();
  const swatch = groupPalette[scheme][color];

  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text variant="label" tone="muted">
          {t('groups.form.emoji')}
        </Text>
        <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel={t('groups.form.noEmoji')}
            accessibilityState={{ checked: emoji === null }}
            onPress={() => onEmojiChange(null)}
            className={cn(
              'h-12 w-12 items-center justify-center rounded-xl border-2',
              emoji === null ? 'border-primary' : 'border-transparent',
            )}
            style={{ backgroundColor: swatch.tile }}
          >
            <NativeText allowFontScaling={false} style={{ fontSize: 20, color: swatch.ink }}>
              {initialOf(name || '?')}
            </NativeText>
          </Pressable>
          {GROUP_EMOJIS.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={t('groups.form.emojiA11y', { emoji: option })}
              accessibilityState={{ checked: emoji === option }}
              onPress={() => onEmojiChange(option)}
              className={cn(
                'h-12 w-12 items-center justify-center rounded-xl border-2',
                emoji === option
                  ? 'border-primary bg-primary-soft'
                  : 'border-transparent bg-surface-muted',
              )}
            >
              <NativeText allowFontScaling={false} style={{ fontSize: 22 }}>
                {option}
              </NativeText>
            </Pressable>
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Text variant="label" tone="muted">
          {t('groups.form.color')}
        </Text>
        <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
          {GROUP_COLORS.map((option) => {
            const selected = option === color;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityLabel={t(`groups.form.colors.${option}`)}
                accessibilityState={{ checked: selected }}
                onPress={() => onColorChange(option)}
                className={cn(
                  'h-12 w-12 items-center justify-center rounded-full border-2',
                  selected ? 'border-fg' : 'border-line',
                )}
                style={{ backgroundColor: groupPalette[scheme][option].tile }}
              >
                {selected ? (
                  <Check size={20} color={groupPalette[scheme][option].ink} strokeWidth={3} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
