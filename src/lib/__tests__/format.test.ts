import { money } from '@/domain';

import { formatMoney } from '../format';

const normalize = (text: string) => text.replace(/\s/g, ' ');

describe('formatMoney', () => {
  it('usa los decimales de la moneda y el formato del idioma', () => {
    expect(normalize(formatMoney(money(123456, 'USD'), 'en-US'))).toBe('$1,234.56');
    expect(normalize(formatMoney(money(1000, 'JPY'), 'en-US'))).toBe('¥1,000');
    expect(normalize(formatMoney(money(1234, 'KWD'), 'en-US'))).toBe('KWD 1.234');
    expect(normalize(formatMoney(money(123456, 'EUR'), 'es-ES'))).toBe('1234,56 €');
  });

  it('muestra los negativos con signo', () => {
    expect(normalize(formatMoney(money(-500, 'USD'), 'en-US'))).toBe('-$5.00');
  });
});
