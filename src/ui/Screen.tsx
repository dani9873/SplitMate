import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn } from './cn';
import { Text } from './Text';

type Edge = 'top' | 'bottom';

export interface ScreenProps {
  children: ReactNode;
  /** Título grande al inicio de la pantalla, ya traducido. */
  title?: string;
  /** Contenido desplazable. Sin scroll, el contenido ocupa el alto disponible. */
  scroll?: boolean;
  /** Bordes con área segura. Por defecto solo arriba: la barra de pestañas cubre el inferior. */
  edges?: readonly Edge[];
  className?: string;
  testID?: string;
}

/** Contenedor base de cada pantalla: fondo, área segura, márgenes y título. */
export function Screen({
  children,
  title,
  scroll = false,
  edges = ['top'],
  className,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const safeArea = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
  };
  const header = title ? (
    <Text variant="title" className="pb-2 pt-4">
      {title}
    </Text>
  ) : null;

  if (scroll) {
    return (
      <View testID={testID} className="flex-1 bg-background" style={safeArea}>
        <ScrollView
          contentContainerClassName={cn('gap-6 px-5 pb-10', !title && 'pt-4', className)}
          keyboardShouldPersistTaps="handled"
        >
          {header}
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View testID={testID} className="flex-1 bg-background px-5" style={safeArea}>
      {header}
      <View className={cn('flex-1', className)}>{children}</View>
    </View>
  );
}
