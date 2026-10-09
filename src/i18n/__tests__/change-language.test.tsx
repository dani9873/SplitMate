import { act, render, screen } from '@testing-library/react-native';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { changeLanguage, i18n } from '..';

function TabLabel() {
  const { t } = useTranslation();
  return <Text>{t('tabs.groups')}</Text>;
}

describe('cambio de idioma', () => {
  afterEach(async () => {
    await act(() => changeLanguage('en'));
  });

  it('actualiza los textos en pantalla sin volver a montar la app', async () => {
    await act(() => changeLanguage('es'));
    await render(<TabLabel />);
    expect(screen.getByText('Grupos')).toBeOnTheScreen();

    await act(() => changeLanguage('en'));

    expect(screen.getByText('Groups')).toBeOnTheScreen();
    expect(screen.queryByText('Grupos')).not.toBeOnTheScreen();
  });

  it('no vuelve a cambiar si el idioma ya está activo', async () => {
    await act(() => changeLanguage('es'));
    const spy = jest.spyOn(i18n, 'changeLanguage');

    await act(() => changeLanguage('es'));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
