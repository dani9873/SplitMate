import { Text as NativeText, View } from 'react-native';

import type { GroupColor } from '@/lib/group-appearance';

import { cn } from './cn';
import { fontFamily, groupPalette, useAppTheme } from './theme';

/** Primera letra visible del nombre, sin partir emojis ni letras con tilde. */
export function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase();
}

const sizes = {
  sm: { box: 'h-9 w-9 rounded-lg', font: 16, emoji: 18 },
  md: { box: 'h-12 w-12 rounded-xl', font: 20, emoji: 24 },
  lg: { box: 'h-16 w-16 rounded-2xl', font: 26, emoji: 32 },
} as const;

export interface GroupAvatarProps {
  name: string;
  emoji: string | null;
  color: GroupColor;
  size?: keyof typeof sizes;
  className?: string;
}

/** Ícono del grupo: su emoji o su inicial sobre el color elegido. Decorativo. */
export function GroupAvatar({ name, emoji, color, size = 'md', className }: GroupAvatarProps) {
  const { scheme } = useAppTheme();
  const swatch = groupPalette[scheme][color] ?? groupPalette[scheme].teal;
  const dims = sizes[size];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('items-center justify-center', dims.box, className)}
      style={{ backgroundColor: swatch.tile }}
    >
      <NativeText
        allowFontScaling={false}
        style={{
          fontSize: emoji ? dims.emoji : dims.font,
          color: swatch.ink,
          fontFamily: emoji ? undefined : fontFamily.extrabold,
        }}
      >
        {emoji ?? initialOf(name)}
      </NativeText>
    </View>
  );
}

export interface MemberAvatarProps {
  name: string;
  /** Resalta al miembro que es "yo". */
  highlight?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/** Inicial del miembro en un círculo neutro. Decorativo: el nombre siempre va al lado. */
export function MemberAvatar({
  name,
  highlight = false,
  size = 'sm',
  className,
}: MemberAvatarProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn(
        'items-center justify-center rounded-full',
        size === 'sm' ? 'h-9 w-9' : 'h-11 w-11',
        highlight ? 'bg-primary-soft' : 'bg-surface-muted',
        className,
      )}
    >
      <NativeText
        allowFontScaling={false}
        className={cn('font-sans-bold', highlight ? 'text-primary' : 'text-fg-muted')}
        style={{ fontSize: size === 'sm' ? 15 : 18 }}
      >
        {initialOf(name)}
      </NativeText>
    </View>
  );
}
