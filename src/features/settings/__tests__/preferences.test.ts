import { defaultPreferences, parseStoredPreferences } from '../preferences';

describe('parseStoredPreferences', () => {
  it('acepta preferencias válidas', () => {
    expect(parseStoredPreferences({ language: 'es', theme: 'dark' })).toEqual({
      language: 'es',
      theme: 'dark',
    });
  });

  it('vuelve a "system" ante un idioma o tema desconocidos', () => {
    expect(parseStoredPreferences({ language: 'klingon', theme: 'morado' })).toEqual({
      language: 'system',
      theme: 'system',
    });
  });

  it('conserva los campos válidos aunque otro sea inválido', () => {
    expect(parseStoredPreferences({ language: 'en', theme: 42 })).toEqual({
      language: 'en',
      theme: 'system',
    });
  });

  it.each([undefined, null, 'texto', 7, []])('usa los valores por defecto con %p', (value) => {
    expect(parseStoredPreferences(value)).toEqual(defaultPreferences);
  });
});
