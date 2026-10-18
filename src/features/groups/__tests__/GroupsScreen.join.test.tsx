import { act, screen, userEvent } from '@testing-library/react-native';

import { changeLanguage } from '@/i18n';
import { renderWithDatabase } from '@/test/render';

import { GroupsScreen } from '../GroupsScreen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

beforeEach(async () => {
  mockPush.mockClear();
  await act(() => changeLanguage('es'));
});

afterEach(async () => {
  await act(() => changeLanguage('en'));
});

describe('lista de grupos: Unirme con un enlace', () => {
  it('hay un botón que abre la pantalla para pegar el enlace', async () => {
    const user = userEvent.setup();
    await renderWithDatabase(<GroupsScreen />);
    await user.press(await screen.findByRole('button', { name: 'Unirme con un enlace' }));
    expect(mockPush).toHaveBeenCalledWith('/join');
  });

  it('en inglés', async () => {
    await act(() => changeLanguage('en'));
    await renderWithDatabase(<GroupsScreen />);
    expect(await screen.findByRole('button', { name: 'Join with a link' })).toBeOnTheScreen();
  });
});
