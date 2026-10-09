# Traducciones

Los textos de la app viven en `locales/<código>.json`, uno por idioma. Ningún componente
lleva textos fijos: todo pasa por `t('clave')` de `react-i18next`, y una regla de ESLint
bloquea los textos literales en JSX.

## Cómo agregar un idioma

1. Copia `locales/en.json` como `locales/<código>.json`. Usa el código ISO 639-1 en
   minúsculas, por ejemplo `fr.json` o `pt.json`.
2. Traduce los valores. No cambies las claves. En `meta.nativeName` escribe el nombre
   del idioma en ese idioma, por ejemplo `Français`.
3. Registra el archivo en `languages.ts`: un `import` y una entrada en `languages`.

Nada más. El selector de Ajustes lo muestra solo y la detección del idioma del
dispositivo lo reconoce automáticamente.

## Qué impide errores

- `languages.ts` usa `satisfies`, así que TypeScript marca las claves que falten.
- La prueba `__tests__/locales.test.ts` exige que todos los idiomas tengan exactamente
  las mismas claves que `en.json` y que ningún valor quede vacío.
- Las claves están tipadas: `t('clave.inexistente')` falla en `npx tsc --noEmit`.

## Cómo se elige el idioma

- Por defecto se sigue el idioma del dispositivo. Si no está disponible, se usa inglés.
- El usuario puede fijar uno en Ajustes. La elección se guarda y se aplica al instante,
  sin reiniciar la app.
