import { render, screen, userEvent } from '@testing-library/react-native';

import { Input } from '../Input';

describe('Input', () => {
  it('asocia la etiqueta al campo y entrega lo que se escribe', async () => {
    const user = userEvent.setup();
    const onChangeText = jest.fn();
    await render(<Input label="Nombre del grupo" onChangeText={onChangeText} />);

    await user.type(screen.getByLabelText('Nombre del grupo'), 'Viaje');

    expect(onChangeText).toHaveBeenLastCalledWith('Viaje');
  });

  it('muestra la ayuda cuando no hay error', async () => {
    await render(<Input label="Nombre" hint="Máximo 40 caracteres" />);

    expect(screen.getByText('Máximo 40 caracteres')).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  it('reemplaza la ayuda por el error y lo anuncia como alerta', async () => {
    await render(
      <Input label="Nombre" hint="Máximo 40 caracteres" error="El nombre es obligatorio" />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('El nombre es obligatorio');
    expect(screen.queryByText('Máximo 40 caracteres')).not.toBeOnTheScreen();
  });

  it('queda deshabilitado cuando no es editable', async () => {
    await render(<Input label="Moneda" editable={false} />);

    expect(screen.getByLabelText('Moneda')).toBeDisabled();
  });
});
