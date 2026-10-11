import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';
import { useAppTheme } from './theme';

export interface ToastProps {
  /** Lo que acaba de pasar, ya traducido: "Gasto borrado". */
  message: string;
  /** Acción para revertirlo, ya traducida: "Deshacer". */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  className?: string;
}

/**
 * Aviso breve en la parte inferior. Usa los colores invertidos del tema para destacar sobre
 * cualquier pantalla. Es una región viva: los lectores de pantalla lo anuncian al aparecer.
 */
export function Toast({ message, actionLabel, onAction, onDismiss, className }: ToastProps) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      className={cn('flex-row items-center gap-1 rounded-lg bg-fg py-1 pl-4 pr-1', className)}
    >
      <Text
        variant="label"
        className="flex-1 py-2"
        style={{ color: colors.background }}
        accessibilityRole="alert"
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          className="min-h-[44px] justify-center rounded-md px-3 active:opacity-70"
        >
          <Text variant="label" className="font-sans-bold" style={{ color: colors.primarySoft }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ui.toast.dismiss')}
        onPress={onDismiss}
        hitSlop={4}
        className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
      >
        <X size={18} color={colors.background} />
      </Pressable>
    </View>
  );
}
