import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { Plus } from 'lucide-react-native';

import { DEFAULT_PRESS_COOLDOWN_MS } from '../press-guard';
import { IconButton } from '../IconButton';

describe('IconButton', () => {
  it('responde al toque con su nombre accesible', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<IconButton icon={Plus} label="Agregar" onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: 'Agregar' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignora el segundo toque seguido', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<IconButton icon={Plus} label="Agregar" onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Agregar' });
    await user.press(button);
    await user.press(button);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('con repeatable acepta toques seguidos a propósito', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<IconButton icon={Plus} label="Sumar" repeatable onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Sumar' });
    await user.press(button);
    await user.press(button);

    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('IconButton: ventana de toques repetidos', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('la ventana compartida es de 300 ms', () => {
    expect(DEFAULT_PRESS_COOLDOWN_MS).toBe(300);
  });

  it('a los 299 ms el segundo toque se ignora y a los 300 ms se acepta', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon={Plus} label="Agregar" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Agregar' });

    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
