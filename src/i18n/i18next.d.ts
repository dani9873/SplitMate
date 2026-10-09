import 'i18next';

import type devResource from '../features/dev/locales/en.json';
import type { TranslationResource } from './languages';

// Tipa las claves de traducción: `t('clave.inexistente')` falla en `tsc`.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: TranslationResource; dev: typeof devResource };
  }
}
