import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';
import { useAppTheme } from './theme';

export interface BannerProps {
  icon: LucideIcon;
  /** Texto ya traducido. */
  message: string;
  /** Botones de acción, por ejemplo Recuperar y Descartar. */
  actions?: ReactNode;
  tone?: 'info' | 'warning';
  className?: string;
  testID?: string;
}

/** Aviso dentro de la pantalla: un grupo archivado o un borrador para recuperar. */
export function Banner({
  icon: Icon,
  message,
  actions,
  tone = 'info',
  className,
  testID,
}: BannerProps) {
  const { colors } = useAppTheme();
  return (
    <View
      testID={testID}
      className={cn(
        'gap-3 rounded-lg border px-4 py-3',
        tone === 'warning' ? 'border-warning bg-warning-soft' : 'border-primary bg-primary-soft',
        className,
      )}
    >
      <View className="flex-row items-start gap-3" accessible>
        <Icon size={20} color={tone === 'warning' ? colors.warning : colors.primary} />
        <Text variant="label" className="flex-1">
          {message}
        </Text>
      </View>
      {actions ? <View className="flex-row flex-wrap justify-end gap-2">{actions}</View> : null}
    </View>
  );
}
