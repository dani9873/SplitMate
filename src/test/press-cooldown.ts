import { act } from '@testing-library/react-native';

import { DEFAULT_PRESS_COOLDOWN_MS } from '@/ui/press-guard';

/**
 * Espera a que termine la protección contra toques repetidos de los botones. Las pruebas que
 * tocan el mismo botón dos veces a propósito (corregir un error y volver a enviar, o dos pasos de
 * una confirmación) lo usan entre un toque y otro; una persona tarda más que esto.
 *
 * `renderRouter` de Expo Router activa temporizadores falsos y el resto de las pruebas usa los
 * reales: la espera se adapta a los dos.
 */
export async function waitForPressCooldown(): Promise<void> {
  const ms = DEFAULT_PRESS_COOLDOWN_MS + 50;
  if ('clock' in setTimeout) {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    return;
  }
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}
