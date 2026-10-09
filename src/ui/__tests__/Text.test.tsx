import { render, screen } from '@testing-library/react-native';

import { Text } from '../Text';

describe('Text', () => {
  it('muestra su contenido', async () => {
    await render(<Text>Hola</Text>);

    expect(screen.getByText('Hola')).toBeOnTheScreen();
  });

  it('expone los títulos como encabezados accesibles', async () => {
    await render(<Text variant="title">Grupos</Text>);

    expect(screen.getByRole('header', { name: 'Grupos' })).toBeOnTheScreen();
  });

  it('no marca como encabezado el texto de cuerpo', async () => {
    await render(<Text>Detalle</Text>);

    expect(screen.queryByRole('header')).not.toBeOnTheScreen();
  });

  it('usa cifras tabulares cuando se pide, para alinear montos', async () => {
    await render(<Text tabular>1.250,00</Text>);

    expect(screen.getByText('1.250,00')).toHaveStyle({ fontVariant: ['tabular-nums'] });
  });
});
