import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Button } from './Button';
import { cn } from './cn';
import { Text } from './Text';
import { useAppTheme } from './theme';

export interface EmptyStateProps {
  icon: LucideIcon;
  /** Textos ya traducidos. */
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  className?: string;
  testID?: string;
}

/**
 * Estado vacío con el motivo de la marca: las dos mitades desplazadas de una moneda,
 * en tonos suaves, detrás del ícono de la sección.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  testID,
}: EmptyStateProps) {
  const { colors } = useAppTheme();

  return (
    <View
      testID={testID}
      className={cn('flex-1 items-center justify-center gap-3 px-4 pb-16', className)}
    >
      <View
        className="mb-2 h-32 w-32 items-center justify-center"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg width={128} height={128} viewBox="0 0 128 128" style={{ position: 'absolute' }}>
          <Path d="M60 14 A44 44 0 0 0 60 102 Z" fill={colors.primarySoft} />
          <Path d="M68 26 A44 44 0 0 1 68 114 Z" fill={colors.accentSoft} />
        </Svg>
        <Icon size={40} color={colors.primary} strokeWidth={1.8} />
      </View>
      <Text variant="heading" className="text-center">
        {title}
      </Text>
      {description ? (
        <Text tone="muted" className="max-w-[320px] text-center">
          {description}
        </Text>
      ) : null}
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant="secondary"
          className="mt-3"
        />
      ) : null}
    </View>
  );
}
