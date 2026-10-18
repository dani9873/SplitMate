import { act, render, screen, userEvent } from '@testing-library/react-native';

import { changeLanguage } from '@/i18n';

import { clearPendingInvite, peekPendingInvite } from '../pending-invite';
import { JoinWithLinkScreen } from '../JoinWithLinkScreen';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: mockReplace,
    canGoBack: () => false,
  }),
}));

const TOKEN = 'v'.repeat(43);

beforeEach(async () => {
  mockReplace.mockClear();
  await act(() => changeLanguage('es'));
});

afterEach(async () => {
  await act(async () => clearPendingInvite());
  await act(() => changeLanguage('en'));
});

describe('Unirme con un enlace', () => {
  it('"Continuar" espera a que haya algo escrito', async () => {
    await render(<JoinWithLinkScreen />);
    expect(screen.getByTestId('join-continue')).toBeDisabled();
  });

  it.each([
    ['el enlace con el esquema propio', `splitmate://i#${TOKEN}`],
    ['el token solo', TOKEN],
    ['un mensaje con el enlace dentro', `Únete a «Viaje»:\nsplitmate://i#${TOKEN}\n¡Vence pronto!`],
  ])('con %s: guarda el enlace pendiente y abre la pantalla de unirse', async (_name, text) => {
    const user = userEvent.setup();
    await render(<JoinWithLinkScreen />);
    await user.type(screen.getByTestId('join-link'), text);
    await user.press(screen.getByTestId('join-continue'));

    expect(peekPendingInvite()).toBe(TOKEN);
    expect(mockReplace).toHaveBeenCalledWith('/invite');
    // El token viaja por la memoria, nunca por la ruta.
    expect(JSON.stringify(mockReplace.mock.calls)).not.toContain(TOKEN);
  });

  it.each([
    ['texto cualquiera', 'hola, ¿cómo estás?'],
    ['un enlace de otro dominio', `https://otro.example.com/i#${TOKEN}`],
    ['un token corto', 'abc123'],
    ['un enlace sin token', 'splitmate://i'],
  ])('con %s: lo dice y no cambia de pantalla', async (_name, text) => {
    const user = userEvent.setup();
    await render(<JoinWithLinkScreen />);
    await user.type(screen.getByTestId('join-link'), text);
    await user.press(screen.getByTestId('join-continue'));

    expect(
      await screen.findByText('Ese texto no es un enlace de invitación de SplitMate.'),
    ).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(peekPendingInvite()).toBeNull();
  });

  it('el error se quita al seguir escribiendo', async () => {
    const user = userEvent.setup();
    await render(<JoinWithLinkScreen />);
    await user.type(screen.getByTestId('join-link'), 'hola');
    await user.press(screen.getByTestId('join-continue'));
    await screen.findByText('Ese texto no es un enlace de invitación de SplitMate.');
    await user.type(screen.getByTestId('join-link'), '!');
    expect(screen.queryByText('Ese texto no es un enlace de invitación de SplitMate.')).toBeNull();
  });

  it('en inglés', async () => {
    await act(() => changeLanguage('en'));
    await render(<JoinWithLinkScreen />);
    expect(screen.getByText('Invitation link')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeOnTheScreen();
  });
});
