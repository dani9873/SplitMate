import { act, render, screen } from '@testing-library/react-native';
import { DeviceEventEmitter, Platform, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';

import { Sheet } from '../Sheet';

// Un teléfono con 24 puntos de barra de navegación abajo.
const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 32, right: 0, bottom: 24, left: 0 },
};

function emitKeyboard(event: string, height: number) {
  DeviceEventEmitter.emit(event, {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: { screenX: 0, screenY: 800 - height, width: 400, height },
  });
}

async function renderSheet() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Sheet visible onClose={jest.fn()} title="Moneda" testID="sheet">
        <Text>Contenido</Text>
      </Sheet>
    </SafeAreaProvider>,
  );
  return screen.getByTestId('sheet');
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Sheet con el teclado abierto', () => {
  it('en Android deja el contenido encima del teclado y de la barra de navegación', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const sheet = await renderSheet();
    expect(sheet).toHaveStyle({ paddingBottom: 24 + 8 });

    // Android informa el alto del teclado sin la barra de navegación, que queda debajo de él.
    await act(() => emitKeyboard('keyboardDidShow', 300));
    expect(sheet).toHaveStyle({ paddingBottom: 300 + 24 + 8 });

    await act(() => emitKeyboard('keyboardDidHide', 0));
    expect(sheet).toHaveStyle({ paddingBottom: 24 + 8 });
  });

  it('en iOS el alto del teclado ya incluye el borde inferior de la pantalla', async () => {
    const sheet = await renderSheet();

    await act(() => emitKeyboard('keyboardWillShow', 336));
    expect(sheet).toHaveStyle({ paddingBottom: 336 + 8 });

    await act(() => emitKeyboard('keyboardWillHide', 0));
    expect(sheet).toHaveStyle({ paddingBottom: 24 + 8 });
  });
});
