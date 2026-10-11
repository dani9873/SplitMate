import { useRouter } from 'expo-router';
import { ArrowLeft, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { IconButton, Text } from '@/ui';

export interface ScreenHeaderProps {
  title: string;
  /** `modal` muestra una X para cerrar; `push`, una flecha para volver. */
  variant?: 'push' | 'modal';
  /** Acción al volver o cerrar. Por defecto, la pantalla anterior. */
  onBack?: () => void;
  actions?: ReactNode;
}

/** Barra superior de las pantallas fuera de las pestañas, con volver o cerrar y acciones. */
export function ScreenHeader({ title, variant = 'push', onBack, actions }: ScreenHeaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View className="min-h-[56px] flex-row items-center gap-1 py-1">
      <IconButton
        icon={variant === 'modal' ? X : ArrowLeft}
        label={variant === 'modal' ? t('ui.close') : t('common.back')}
        onPress={back}
        className="-ml-2"
      />
      <Text variant="heading" numberOfLines={1} className="flex-1" accessibilityRole="header">
        {title}
      </Text>
      {actions}
    </View>
  );
}
