# SplitMate

App móvil para registrar y liquidar gastos compartidos en grupo, para Android e iOS.
Las reglas del proyecto y el plan por fases están en [CLAUDE.md](CLAUDE.md).

## Requisitos

- Node.js 22.13 o superior y npm 10.
- Una cuenta de Expo para los development builds con EAS Build.
- Un teléfono Android o un emulador para probar la app.

## Empezar

```bash
npm install
npx expo start
```

El proyecto usa un development build: una versión propia de la app que reemplaza a Expo Go
y muestra el splash y los íconos reales. Para cambios rápidos de interfaz también sirve
Expo Go; pulsa `s` en la terminal de Metro para alternar entre ambos modos.

## Development build en Android

Los builds se hacen en la nube con EAS Build, porque el build local falla desde una ruta
dentro de OneDrive por el límite de longitud de rutas de Windows.

```bash
npx eas-cli build --profile development --platform android
```

Solo hace falta repetirlo cuando cambian dependencias nativas, íconos, splash o `app.json`.
Los cambios de JavaScript llegan por Metro sin recompilar.

1. Abre en el teléfono el enlace del build que da EAS, descarga el APK e instálalo.
   Android pedirá permitir instalaciones desde el navegador.
2. En el PC ejecuta `npx expo start`.
3. Con el teléfono y el PC en la misma red Wi-Fi, abre SplitMate en el teléfono y elige el
   servidor de la lista, o escanea el código QR con la cámara.
4. Por cable USB: ejecuta `adb reverse tcp:8081 tcp:8081` y en la app abre
   `http://localhost:8081`.

## Scripts

| Comando              | Qué hace                                                  |
| -------------------- | --------------------------------------------------------- |
| `npm start`          | Servidor de desarrollo de Expo                            |
| `npm run typecheck`  | `tsc --noEmit` con TypeScript estricto                    |
| `npm run lint`       | ESLint y Prettier sobre todo el repo, sin advertencias    |
| `npm run format`     | Formatea el código con Prettier                           |
| `npm test`           | Pruebas con Jest, una sola ejecución, apta para CI        |
| `npm run test:watch` | Pruebas en modo watch para desarrollo                     |
| `npm run check`      | Tipos, lint y pruebas, lo mismo que corre CI en cada push |
| `npm run icons`      | Regenera íconos y splash desde `assets/brand/logo.svg`    |

## Estructura

```
app/            Rutas de Expo Router: pantallas delgadas que importan de src/features
src/
  domain/       Lógica pura de dinero, división y saldos (Fase 1)
  db/           SQLite y Drizzle (Fase 1)
  features/     Funcionalidades: grupos, actividad, ajustes, navegación
  ui/           Sistema de diseño: tokens, tema y componentes base
  i18n/         Traducciones y detección de idioma
  lib/          Utilidades compartidas
assets/brand/   Logo fuente de los íconos y el splash
design/         Material de diseño fuera del bundle: propuestas de logo y capturas
```

- Sistema de diseño y sus decisiones: [src/ui/README.md](src/ui/README.md).
- Traducciones y cómo agregar un idioma: [src/i18n/README.md](src/i18n/README.md).

## Calidad

Cada push y pull request corre el workflow de GitHub Actions con `npm ci`, tipos, lint y
pruebas. Ningún texto visible va fijo en el código: una regla de ESLint lo impide.
