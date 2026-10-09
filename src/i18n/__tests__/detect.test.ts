import { detectDeviceLanguage, resolveLanguage } from '../detect';

describe('detectDeviceLanguage', () => {
  it('elige el primer idioma del dispositivo que la app soporta', () => {
    const locales = [{ languageCode: 'fr' }, { languageCode: 'es' }, { languageCode: 'en' }];

    expect(detectDeviceLanguage(locales)).toBe('es');
  });

  it('reconoce variantes regionales por su código de idioma', () => {
    // es-MX, es-AR o es-ES llegan con languageCode "es"
    expect(detectDeviceLanguage([{ languageCode: 'es' }])).toBe('es');
  });

  it('usa inglés si ningún idioma del dispositivo está disponible', () => {
    expect(detectDeviceLanguage([{ languageCode: 'de' }, { languageCode: 'ja' }])).toBe('en');
  });

  it('ignora entradas sin código y acepta mayúsculas', () => {
    expect(detectDeviceLanguage([{ languageCode: null }, { languageCode: 'ES' }])).toBe('es');
  });

  it('usa inglés si el dispositivo no informa idiomas', () => {
    expect(detectDeviceLanguage([])).toBe('en');
  });
});

describe('resolveLanguage', () => {
  it('sigue al dispositivo cuando la preferencia es "system"', () => {
    expect(resolveLanguage('system', [{ languageCode: 'es' }])).toBe('es');
  });

  it('respeta un idioma elegido aunque el dispositivo use otro', () => {
    expect(resolveLanguage('en', [{ languageCode: 'es' }])).toBe('en');
  });
});
