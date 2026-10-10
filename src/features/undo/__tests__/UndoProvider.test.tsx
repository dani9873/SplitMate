import { act, render, screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo, Pressable, Text } from 'react-native';

import { changeLanguage } from '@/i18n';

import { UNDO_TIMEOUT_MS, UndoProvider, useUndo } from '../UndoProvider';

function Trigger({ undo }: { undo: () => void }) {
  const { offerUndo } = useUndo();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => offerUndo({ message: 'Gasto borrado', undo })}
    >
      <Text>Borrar</Text>
    </Pressable>
  );
}

describe('UndoProvider', () => {
  beforeEach(async () => {
    await act(() => changeLanguage('es'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('ofrece deshacer, lo anuncia y se cierra solo a los 6 segundos', async () => {
    jest.useFakeTimers();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(
      <UndoProvider>
        <Trigger undo={jest.fn()} />
      </UndoProvider>,
    );

    await user.press(screen.getByRole('button', { name: 'Borrar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Gasto borrado');
    expect(announce).toHaveBeenCalledWith('Gasto borrado. Puedes deshacerlo.');

    await act(() => jest.advanceTimersByTime(UNDO_TIMEOUT_MS));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('con lector de pantalla no se cierra solo', async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(
      <UndoProvider>
        <Trigger undo={jest.fn()} />
      </UndoProvider>,
    );
    await act(async () => {});

    await user.press(screen.getByRole('button', { name: 'Borrar' }));
    await act(() => jest.advanceTimersByTime(UNDO_TIMEOUT_MS * 5));
    expect(screen.getByRole('alert')).toHaveTextContent('Gasto borrado');
  });

  it('deshace la acción y avisa si no se pudo', async () => {
    const user = userEvent.setup();
    const undo = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await render(
      <UndoProvider>
        <Trigger undo={undo} />
      </UndoProvider>,
    );
    await user.press(screen.getByRole('button', { name: 'Borrar' }));
    await user.press(screen.getByRole('button', { name: 'Deshacer' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();

    undo.mockImplementation(() => {
      throw new Error('cambió');
    });
    await user.press(screen.getByRole('button', { name: 'Borrar' }));
    await user.press(screen.getByRole('button', { name: 'Deshacer' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudo deshacer: el movimiento cambió.',
    );
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
  });
});
