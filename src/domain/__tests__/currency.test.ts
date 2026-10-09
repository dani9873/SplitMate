import { currencyCode, isKnownCurrency, minorUnits } from '../currency';
import { DomainError } from '../errors';

describe('monedas ISO 4217', () => {
  it('respeta los decimales de cada moneda', () => {
    expect(minorUnits(currencyCode('USD'))).toBe(2);
    expect(minorUnits(currencyCode('EUR'))).toBe(2);
    expect(minorUnits(currencyCode('JPY'))).toBe(0);
    expect(minorUnits(currencyCode('CLP'))).toBe(0);
    expect(minorUnits(currencyCode('KWD'))).toBe(3);
    expect(minorUnits(currencyCode('BHD'))).toBe(3);
  });

  it('reconoce los códigos vigentes y rechaza los demás', () => {
    expect(isKnownCurrency('COP')).toBe(true);
    expect(isKnownCurrency('usd')).toBe(false);
    expect(isKnownCurrency('ZZZ')).toBe(false);
    expect(isKnownCurrency('XAU')).toBe(false);
  });

  it('lanza UNKNOWN_CURRENCY ante un código desconocido', () => {
    expect(() => currencyCode('ABC')).toThrow(DomainError);
    expect(() => currencyCode('ABC')).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_CURRENCY' }),
    );
  });
});
