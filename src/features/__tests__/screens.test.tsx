import { act, render, screen, userEvent } from '@testing-library/react-native';

import { ActivityScreen } from '@/features/activity';
import { GroupsScreen } from '@/features/groups';
import { NotFoundScreen } from '@/features/navigation';
import { changeLanguage } from '@/i18n';
import { renderWithDatabase } from '@/test/render';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ replace: mockReplace }),
}));

describe('pantallas base', () => {
  afterEach(async () => {
    await act(() => changeLanguage('en'));
  });

  it('Grupos muestra su título y el estado vacío traducidos', async () => {
    await act(() => changeLanguage('es'));
    await renderWithDatabase(<GroupsScreen />);

    expect(screen.getByRole('header', { name: 'Grupos' })).toBeOnTheScreen();
    expect(await screen.findByRole('header', { name: 'Aún no tienes grupos' })).toBeOnTheScreen();
  });

  it('Actividad muestra su título y el estado vacío traducidos', async () => {
    await act(() => changeLanguage('en'));
    await renderWithDatabase(<ActivityScreen />);

    expect(screen.getByRole('header', { name: 'Activity' })).toBeOnTheScreen();
    expect(await screen.findByRole('header', { name: 'Nothing here yet' })).toBeOnTheScreen();
  });

  it('la ruta inexistente lleva de vuelta a los grupos', async () => {
    const user = userEvent.setup();
    await act(() => changeLanguage('es'));
    await render(<NotFoundScreen />);

    await user.press(screen.getByRole('button', { name: 'Ir a mis grupos' }));

    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
