import { X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from './IconButton';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** Título de la hoja, ya traducido. */
  title: string;
  children: ReactNode;
  testID?: string;
}

/**
 * Hoja que sube desde abajo para elegir algo sin salir del formulario: fecha, moneda o
 * miembro. Modal para los lectores de pantalla; el botón atrás de Android la cierra.
 */
export function Sheet({ visible, onClose, title, children, testID }: SheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityLabel={t('ui.close')}
          onPress={onClose}
          className="absolute inset-0 bg-black/40"
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          className="max-h-[85%] rounded-t-2xl bg-surface"
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          <View className="flex-row items-center gap-2 py-2 pl-5 pr-2">
            <Text variant="heading" className="flex-1">
              {title}
            </Text>
            <IconButton icon={X} label={t('ui.close')} onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
