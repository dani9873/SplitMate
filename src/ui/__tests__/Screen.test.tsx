import { render, screen } from '@testing-library/react-native';

import { Screen } from '../Screen';
import { Text } from '../Text';

describe('Screen', () => {
  it('muestra el título como encabezado y el contenido', async () => {
    await render(
      <Screen title="Ajustes">
        <Text>Contenido</Text>
      </Screen>,
    );

    expect(screen.getByRole('header', { name: 'Ajustes' })).toBeOnTheScreen();
    expect(screen.getByText('Contenido')).toBeOnTheScreen();
  });

  it('permite contenido desplazable', async () => {
    await render(
      <Screen title="Ajustes" scroll>
        <Text>Contenido largo</Text>
      </Screen>,
    );

    expect(screen.getByText('Contenido largo')).toBeOnTheScreen();
  });

  it('no muestra encabezado si no hay título', async () => {
    await render(
      <Screen>
        <Text>Contenido</Text>
      </Screen>,
    );

    expect(screen.queryByRole('header')).not.toBeOnTheScreen();
  });
});
