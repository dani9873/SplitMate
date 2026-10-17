import { render, screen, userEvent } from '@testing-library/react-native';
import { Plus } from 'lucide-react-native';

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
