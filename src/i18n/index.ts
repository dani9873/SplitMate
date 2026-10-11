import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { detectDeviceLanguage } from './detect';
import { fallbackLanguage, languages, supportedLanguages, type LanguageCode } from './languages';

const resources = Object.fromEntries(
  Object.entries(languages).map(([code, translation]) => [code, { translation }]),
);

// Instancia propia en lugar del singleton global de i18next.
const i18n = createInstance();

// Inicialización síncrona: las traducciones van dentro del bundle, sin carga por red.
// Arranca con el idioma del dispositivo; la preferencia guardada se aplica al hidratarla.
void i18n.use(initReactI18next).init({
  resources,
  lng: detectDeviceLanguage(),
  fallbackLng: fallbackLanguage,
  supportedLngs: supportedLanguages,
  interpolation: { escapeValue: false }, // React ya escapa el texto
  initAsync: false,
  react: { useSuspense: false },
});

/** Cambia el idioma de toda la app sin reiniciarla. */
export async function changeLanguage(code: LanguageCode): Promise<void> {
  if (i18n.language !== code) {
    await i18n.changeLanguage(code);
  }
}

export { i18n };
export * from './detect';
export * from './languages';
export * from './locale';
export { useFormatters, type Formatters } from './use-formatters';
