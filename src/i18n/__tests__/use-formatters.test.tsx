import { act, render, screen } from '@testing-library/react-native';
import { useLocales } from 'expo-localization';
import { Text } from 'react-native';

import { money } from '@/domain';

import { changeLanguage } from '..';
import { useFormatters } from '../use-formatters';

type DeviceLocale = { languageCode: string; languageTag: string };

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => []),
  useLocales: jest.fn(() => []),
}));

const setDevice = (locales: DeviceLocale[]) => {
  jest.mocked(useLocales).mockReturnValue(locales as ReturnType<typeof useLocales>);
};

function Amounts() {
  const { money: format, decimalSeparator, weekStartsOn } = useFormatters();
  return (
    <>
      <Text testID="gtq">{format(money(100, 'GTQ'))}</Text>
      <Text testID="usd">{format(money(123456, 'USD'))}</Text>
      <Text testID="jpy">{format(money(1000, 'JPY'))}</Text>
      <Text testID="kwd">{format(money(1234, 'KWD'))}</Text>
      <Text testID="decimal">{decimalSeparator}</Text>
      <Text testID="week">{String(weekStartsOn)}</Text>
    </>
  );
}

const text = (testID: string) => {
  const node = screen.getByTestId(testID);
  return String(node.props.children).replace(/\s/g, ' ');
};

// Los dos teléfonos de la prueba: el S24 Ultra y el Poco X3 NFC dieron "GTQ1.00" y "1.00 GTQ".
const PHONES: [string, DeviceLocale[]][] = [
  ['es-US', [{ languageCode: 'es', languageTag: 'es-US' }]],
  ['es-GT', [{ languageCode: 'es', languageTag: 'es-GT' }]],
  ['es-ES', [{ languageCode: 'es', languageTag: 'es-ES' }]],
  ['en-GB', [{ languageCode: 'en', languageTag: 'en-GB' }]],
];

describe('useFormatters', () => {
  afterAll(async () => {
    await act(() => changeLanguage('en'));
  });

  it.each(PHONES)('en español, un teléfono %s muestra el dinero igual', async (_tag, locales) => {
    setDevice(locales);
    await act(() => changeLanguage('es'));
    await render(<Amounts />);

    expect(text('gtq')).toBe('GTQ 1.00');
    expect(text('usd')).toBe('$1,234.56');
    expect(text('jpy')).toBe('¥1,000');
    expect(text('kwd')).toBe('KWD 1.234');
    expect(text('decimal')).toBe('.');
  });

  it.each(PHONES)('en inglés, un teléfono %s muestra el dinero igual', async (_tag, locales) => {
    setDevice(locales);
    await act(() => changeLanguage('en'));
    await render(<Amounts />);

    expect(text('gtq')).toBe('GTQ 1.00');
    expect(text('usd')).toBe('$1,234.56');
    expect(text('jpy')).toBe('¥1,000');
    expect(text('kwd')).toBe('KWD 1.234');
    expect(text('decimal')).toBe('.');
  });

  it('la semana del calendario sigue la región del teléfono, no el formato del dinero', async () => {
    await act(() => changeLanguage('es'));

    setDevice([{ languageCode: 'es', languageTag: 'es-ES' }]);
    const { unmount } = await render(<Amounts />);
    expect(text('week')).toBe('1');
    unmount();

    setDevice([{ languageCode: 'es', languageTag: 'es-GT' }]);
    await render(<Amounts />);
    expect(text('week')).toBe('0');
  });
});
