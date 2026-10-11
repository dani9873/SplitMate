import { TriangleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { cn } from './cn';
import { EmptyState } from './EmptyState';

export interface LoadingStateProps {
  /** Filas de esqueleto que imitan el contenido. */
  rows?: number;
  className?: string;
}

/**
 * Esqueleto mientras llega la primera lectura. Estático, sin animación: dura un instante y
 * así respeta a quien reduce el movimiento. Se anuncia como "Cargando".
 */
export function LoadingState({ rows = 4, className }: LoadingStateProps) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('ui.loading')}
      className={cn('gap-3 py-4', className)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3">
          <View className="h-12 w-12 rounded-xl bg-surface-muted" />
          <View className="flex-1 gap-2">
            <View className="h-3.5 w-3/5 rounded-full bg-surface-muted" />
            <View className="h-3 w-2/5 rounded-full bg-surface-muted" />
          </View>
        </View>
      ))}
    </View>
  );
}

export interface ErrorStateProps {
  onRetry: () => void;
  className?: string;
}

/** Error al leer datos, con reintento. */
export function ErrorState({ onRetry, className }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={TriangleAlert}
      title={t('ui.error.title')}
      description={t('ui.error.description')}
      action={{ label: t('ui.error.retry'), onPress: onRetry }}
      className={className}
    />
  );
}
