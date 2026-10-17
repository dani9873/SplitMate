import { money } from '@/domain';

import { decimalSeparator, formatDay, formatMoney } from '../format';

const normalize = (text: string) => text.replace(/\s/g, ' ');

describe('formatMoney', () => {
  it.each(['es-419', 'en-US'])('usa los decimales de cada moneda con %s', (locale) => {
    expect(normalize(formatMoney(money(123456, 'USD'), locale))).toBe('$1,234.56');
    expect(normalize(formatMoney(money(100, 'GTQ'), locale))).toBe('GTQ 1.00');
    expect(normalize(formatMoney(money(1000, 'JPY'), locale))).toBe('¥1,000');
    expect(normalize(formatMoney(money(1234, 'KWD'), locale))).toBe('KWD 1.234');
    expect(normalize(formatMoney(money(123456, 'EUR'), locale))).toBe('€1,234.56');
    expect(normalize(formatMoney(money(0, 'GTQ'), locale))).toBe('GTQ 0.00');
  });

  it('muestra los negativos con signo antes del símbolo', () => {
    expect(normalize(formatMoney(money(-500, 'USD'), 'en-US'))).toBe('-$5.00');
    expect(normalize(formatMoney(money(-500, 'GTQ'), 'es-419'))).toBe('-GTQ 5.00');
  });

  // El símbolo va antes del monto y se escribe igual en cualquier locale: ni la región ni los datos
  // de ICU de cada teléfono (Samsung dio "GTQ1.00" y Poco "1.00 GTQ") cambian su lugar ni su texto.
  it.each(['es-419', 'es-US', 'es-GT', 'es-CO', 'es-ES', 'es', 'en-US', 'en-GB', 'en'])(
    'el símbolo y su lugar no dependen del locale (%s)',
    (locale) => {
      const text = normalize(formatMoney(money(100, 'GTQ'), locale));
      expect(text.startsWith('GTQ ')).toBe(true);
      expect(text.endsWith('GTQ')).toBe(false);
      expect(normalize(formatMoney(money(100, 'USD'), locale)).startsWith('$')).toBe(true);
    },
  );

  it('los separadores sí siguen al locale que se le pasa', () => {
    expect(normalize(formatMoney(money(123456, 'USD'), 'es'))).toBe('$1234,56');
    expect(normalize(formatMoney(money(1234567, 'USD'), 'es'))).toBe('$12.345,67');
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
