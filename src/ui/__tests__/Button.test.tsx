import { render, screen, userEvent } from '@testing-library/react-native';
import { Plus } from 'lucide-react-native';

import { Button } from '../Button';

describe('Button', () => {
  it('usa la etiqueta como nombre accesible y responde al toque', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<Button label="Guardar" icon={Plus} onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: 'Guardar' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('no responde cuando está deshabilitado', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<Button label="Guardar" disabled onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Guardar' });
    await user.press(button);

    expect(button).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('anuncia el estado ocupado y bloquea la pulsación mientras carga', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(<Button label="Guardar" loading onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Guardar' });
    await user.press(button);

    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });
});
