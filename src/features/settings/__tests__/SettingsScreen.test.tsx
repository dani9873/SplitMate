import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { colorScheme } from 'nativewind';

import { i18n } from '@/i18n';
import { renderWithDatabase } from '@/test/render';

import { usePreferences } from '../preferences-store';
import { SettingsScreen } from '../SettingsScreen';

// El dispositivo de la prueba está en español.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'es' }],
  useLocales: () => [{ languageCode: 'es' }],
}));

describe('SettingsScreen', () => {
  beforeEach(async () => {
    jest.spyOn(colorScheme, 'set').mockImplementation(() => {});
    await usePreferences.persist.rehydrate();
    await act(async () => {
      usePreferences.getState().setLanguage('system');
      usePreferences.getState().setTheme('system');
    });
    await waitFor(() => expect(i18n.language).toBe('es'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('indica qué idioma usa el dispositivo cuando se sigue al sistema', async () => {
    await renderWithDatabase(<SettingsScreen />);

    const system = screen.getByRole('radio', { name: 'Idioma del dispositivo' });
    expect(system).toBeChecked();
    expect(screen.getByText('Ahora: Español')).toBeOnTheScreen();
  });

  it('cambia el idioma de la interfaz al instante y marca la opción', async () => {
    const user = userEvent.setup();
    await renderWithDatabase(<SettingsScreen />);
    expect(screen.getByRole('header', { name: 'Ajustes' })).toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: 'English' }));

    expect(await screen.findByRole('header', { name: 'Settings' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Device language' })).not.toBeChecked();
    expect(usePreferences.getState().language).toBe('en');
  });

  it('cambia el tema al instante y marca la opción', async () => {
    const user = userEvent.setup();
    await renderWithDatabase(<SettingsScreen />);

    await user.press(screen.getByRole('radio', { name: 'Oscuro' }));

    expect(colorScheme.set).toHaveBeenLastCalledWith('dark');
    expect(screen.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Automático' })).not.toBeChecked();
  });
});
