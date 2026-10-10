import { resolveFormattingLocale, weekStartsOn } from '../locale';

describe('locale de formato', () => {
  const colombia = [
    { languageTag: 'es-CO', languageCode: 'es' },
    { languageTag: 'en-US', languageCode: 'en' },
  ];

  it('usa la región del dispositivo cuando el idioma coincide', () => {
    expect(resolveFormattingLocale('es', colombia)).toBe('es-CO');
    expect(resolveFormattingLocale('en', colombia)).toBe('en-US');
    expect(resolveFormattingLocale('en', [{ languageTag: 'es-CO', languageCode: 'es' }])).toBe(
      'en',
    );
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
