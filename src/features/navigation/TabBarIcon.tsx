import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { cn, useAppTheme } from '@/ui';

interface TabBarIconProps {
  icon: LucideIcon;
  focused: boolean;
}

/** Ícono de pestaña con una píldora suave detrás cuando está activa. */
export function TabBarIcon({ icon: Icon, focused }: TabBarIconProps) {
  const { colors } = useAppTheme();
  return (
    <View
      className={cn(
        'h-8 w-14 items-center justify-center rounded-full',
        focused && 'bg-primary-soft',
      )}
    >
      <Icon
        size={22}
        color={focused ? colors.primary : colors.fgMuted}
        strokeWidth={focused ? 2.4 : 2}
      />
    </View>
  );
}
