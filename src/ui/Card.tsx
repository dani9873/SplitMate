import { View, type ViewProps } from 'react-native';

import { cn } from './cn';

export interface CardProps extends ViewProps {
  /** Relleno interno estándar. Desactívalo para listas con separadores propios. */
  padded?: boolean;
  className?: string;
}

/** Superficie sobre el fondo de papel. Sin sombras: borde fino y un tono propio. */
export function Card({ padded = true, className, ...props }: CardProps) {
  return (
    <View
      className={cn('rounded-xl border border-line bg-surface', padded && 'p-4', className)}
      {...props}
    />
  );
}
