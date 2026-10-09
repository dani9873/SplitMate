import { render, screen } from '@testing-library/react-native';

import { Card } from '../Card';
import { Text } from '../Text';

describe('Card', () => {
  it('muestra su contenido', async () => {
    await render(
      <Card testID="card">
        <Text>Saldo</Text>
      </Card>,
    );

    expect(screen.getByTestId('card')).toContainElement(screen.getByText('Saldo'));
  });
});
