import { i18n } from '@/i18n';

import en from './locales/en.json';
import es from './locales/es.json';

// Espacio de traducción propio: estos textos solo existen cuando se carga el módulo de
// desarrollo, así que tampoco llegan al bundle de producción.
i18n.addResourceBundle('en', 'dev', en, true, true);
i18n.addResourceBundle('es', 'dev', es, true, true);
