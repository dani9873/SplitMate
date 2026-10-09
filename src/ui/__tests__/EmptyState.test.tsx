import { render, screen, userEvent } from '@testing-library/react-native';
import { Users } from 'lucide-react-native';

import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('muestra el título como encabezado y la descripción', async () => {
    await render(
      <EmptyState icon={Users} title="Aún no tienes grupos" description="Crea uno para empezar." />,
    );

    expect(screen.getByRole('header', { name: 'Aún no tienes grupos' })).toBeOnTheScreen();
    expect(screen.getByText('Crea uno para empezar.')).toBeOnTheScreen();
  });

  it('ejecuta la acción cuando se ofrece', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await render(
      <EmptyState icon={Users} title="Sin grupos" action={{ label: 'Crear grupo', onPress }} />,
    );

    await user.press(screen.getByRole('button', { name: 'Crear grupo' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('no muestra botón si no hay acción', async () => {
    await render(<EmptyState icon={Users} title="Sin grupos" />);

    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });
});
