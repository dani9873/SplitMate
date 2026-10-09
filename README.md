# SplitMate

App móvil para registrar y liquidar gastos compartidos en grupo, para Android e iOS.
Las reglas del proyecto y el plan por fases están en [CLAUDE.md](CLAUDE.md).

## Requisitos

- Node.js 22.13 o superior y npm 10.
- Para builds locales de Android: Android Studio con un emulador, o un teléfono por USB,
  y Java 17.

## Empezar

```bash
npm install
npx expo start
```

Escanea el código QR con Expo Go o abre un emulador con la tecla `a`. Expo Go sirve para
el día a día; el splash nativo y los íconos solo se ven en un development build.

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
```

- Sistema de diseño y sus decisiones: [src/ui/README.md](src/ui/README.md).
- Traducciones y cómo agregar un idioma: [src/i18n/README.md](src/i18n/README.md).

## Calidad

Cada push y pull request corre el workflow de GitHub Actions con `npm ci`, tipos, lint y
pruebas. Ningún texto visible va fijo en el código: una regla de ESLint lo impide.
