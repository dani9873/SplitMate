import { currencyName, normalizeForSearch } from '../currency-names';

describe('nombres de monedas', () => {
  it('nombra la moneda en el idioma pedido', () => {
    expect(currencyName('COP', 'es')).toMatch(/peso colombiano/i);
    expect(currencyName('EUR', 'en')).toMatch(/euro/i);
  });

  it('sin Intl.DisplayNames usa el nombre largo de NumberFormat', () => {
    // Simula un motor sin DisplayNames, como Hermes.
    const intl = Intl as { DisplayNames?: unknown };
    const original = intl.DisplayNames;
    delete intl.DisplayNames;
    try {
      expect(currencyName('JPY', 'en-GB')).toMatch(/japanese yen/i);
    } finally {
      intl.DisplayNames = original;
    }
  });

  it('normaliza para buscar sin tildes ni mayúsculas', () => {
    expect(normalizeForSearch('  Peso Colombiano ')).toBe('peso colombiano');
    expect(normalizeForSearch('Cumpleaños de Sofía')).toBe('cumpleanos de sofia');
  });
});
