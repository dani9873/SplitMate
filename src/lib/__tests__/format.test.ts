import { money } from '@/domain';

import { decimalSeparator, formatDay, formatMoney } from '../format';

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

describe('decimalSeparator', () => {
  it('sigue al idioma', () => {
    expect(decimalSeparator('es-CO')).toBe(',');
    expect(decimalSeparator('es-ES')).toBe(',');
    expect(decimalSeparator('en-US')).toBe('.');
  });
});

describe('formatDay', () => {
  it('formatea el día de calendario en el idioma pedido', () => {
    expect(formatDay('2026-10-09', 'es', 'weekday')).toBe('viernes, 9 de octubre');
    expect(formatDay('2026-10-09', 'en-US', 'weekday')).toBe('Friday, October 9');
    expect(formatDay('2026-10-09', 'en-US', 'medium')).toBe('Oct 9, 2026');
    expect(formatDay('2026-10-09', 'es', 'long')).toBe('viernes, 9 de octubre de 2026');
  });
});
