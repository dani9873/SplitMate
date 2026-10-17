import { resolveCalendarLocale, resolveFormattingLocale, weekStartsOn } from '../locale';

describe('locale de formato', () => {
  it('depende solo del idioma de la app, no de la región del teléfono', () => {
    expect(resolveFormattingLocale('es')).toBe('es-419');
    expect(resolveFormattingLocale('en')).toBe('en-US');
  });

  it('un idioma sin convención propia se usa tal cual', () => {
    expect(resolveFormattingLocale('fr')).toBe('fr');
  });
});

describe('locale del calendario', () => {
  const colombia = [
    { languageTag: 'es-CO', languageCode: 'es' },
    { languageTag: 'en-US', languageCode: 'en' },
  ];

  it('usa la región del dispositivo cuando el idioma coincide', () => {
    expect(resolveCalendarLocale('es', colombia)).toBe('es-CO');
    expect(resolveCalendarLocale('en', colombia)).toBe('en-US');
    expect(resolveCalendarLocale('en', [{ languageTag: 'es-CO', languageCode: 'es' }])).toBe('en');
  });

  it('elige el primer día de la semana por región', () => {
    expect(weekStartsOn('es-CO')).toBe(0);
    expect(weekStartsOn('es-ES')).toBe(1);
    expect(weekStartsOn('en-US')).toBe(0);
    expect(weekStartsOn('en-GB')).toBe(1);
    expect(weekStartsOn('en')).toBe(0);
    expect(weekStartsOn('es')).toBe(1);
  });
});
