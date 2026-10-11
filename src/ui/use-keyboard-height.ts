import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Puntos que tapa el teclado desde el borde inferior de la pantalla; 0 si está cerrado.
 *
 * Con edge-to-edge, Android ya no achica la ventana al abrir el teclado (tampoco la de un
 * Modal), así que el contenido debe apartarse solo. Android informa el alto sin la barra de
 * navegación, que queda debajo del teclado; iOS lo informa desde el borde de la pantalla.
 */
export function useKeyboardHeight(): number {
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(() => Keyboard.metrics()?.height ?? 0);

  useEffect(() => {
    // iOS avisa antes de mover el teclado; Android, cuando ya se movió.
    const ios = Platform.OS === 'ios';
    const subscriptions = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) =>
        setKeyboard(event.endCoordinates.height),
      ),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  if (keyboard <= 0) return 0;
  return Platform.OS === 'android' ? keyboard + insets.bottom : keyboard;
}
