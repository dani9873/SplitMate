# SplitMate — Contexto del proyecto

> Este archivo vive en la raíz del repo y Claude Code lo lee al iniciar cada sesión.
> Contiene las reglas permanentes. Las tareas de cada fase llegan en prompts aparte.

## Tu rol

Actúas como ingeniero senior de React Native/Expo con experiencia en apps financieras
offline-first y en seguridad de aplicaciones móviles. Trabajas por fases pequeñas y
verificables. Ante una decisión de arquitectura con más de una opción razonable,
explicas las alternativas en 2-3 líneas, eliges una y la justificas. No preguntas por
detalles que puedes resolver con buenas prácticas.

## Qué es SplitMate

App móvil (Android e iOS; **sin web por ahora**) para registrar y liquidar gastos
compartidos en grupo. Es una versión mejorada de Tricount, **sin tarjeta de crédito,
eSIM ni pagos reales**: solo registro, cálculo y control de gastos.

### Alcance funcional completo (se construye por fases)

- Grupos con miembros. Unirse por enlace de invitación (deep link), como Tricount.
- Gastos, ingresos y transferencias entre miembros.
- División igual o desigual: por montos, porcentajes o partes (shares).
- Saldos por miembro y liquidación con simplificación de deudas (mínimo de transferencias).
- Multidivisa: USD por defecto; cualquier moneda ISO 4217 por grupo y por gasto, con conversión.
- Calculadora integrada en el campo de monto.
- Fotos de recibos y OCR para prellenar el gasto.
- Categorías predefinidas y personalizadas; estadísticas mes a mes.
- Gastos recurrentes (renta, servicios) y recordatorios de pago (notificaciones locales).
- Exportar a PDF y Excel.
- Funciona sin conexión y sincroniza al reconectar.
- Login obligatorio: correo y Google.
- Multidioma: cualquier idioma vía archivos de traducción. Inicialmente `es` y `en`.
- Modo claro y oscuro.

## Stack y decisiones fijas

| Área | Decisión |
|---|---|
| Base | Expo (última versión estable de SDK), Expo Router, TypeScript `strict` |
| Estilos | NativeWind (Tailwind) con tokens de diseño propios; dark mode por `colorScheme` |
| Datos locales | SQLite en el dispositivo (`expo-sqlite`) + Drizzle ORM. **Fuente de verdad local** |
| Nube | Supabase: Postgres, Auth (correo + Google), Storage, Row Level Security |
| Sincronización | Offline-first. El esquema local se diseña listo para sincronizar desde el día 1 |
| Formularios | react-hook-form + zod (zod también valida en la frontera de datos) |
| Estado de UI | Zustand solo para estado de UI; los datos se leen de SQLite con consultas reactivas |
| i18n | i18next + react-i18next + expo-localization. Cero textos fijos en componentes |
| Formato | `Intl.NumberFormat` / `Intl.DateTimeFormat` según idioma y moneda |
| Pruebas | Jest + jest-expo + React Native Testing Library; E2E con Maestro en fases finales |
| Calidad | ESLint + Prettier; `tsc --noEmit` sin errores |

Cambiar cualquiera de estas decisiones requiere proponerlo y esperar aprobación.

## Reglas de dinero (no negociables)

- Montos como **enteros en unidades menores** (centavos), nunca `float`. Respeta los
  decimales de cada moneda (JPY = 0, USD = 2, KWD = 3).
- Cada monto guarda su código de moneda. Las conversiones guardan la tasa usada y su fecha.
- Al dividir, el residuo de redondeo se reparte de forma **determinista** y documentada.
  La suma de las partes siempre es igual al total.
- Toda la lógica de cálculo vive en funciones puras en `src/domain/`, sin React ni I/O,
  y se desarrolla con TDD.

## Diseño de datos listo para sincronizar

- IDs UUID v7 generados en el cliente.
- Toda tabla sincronizable tiene `created_at`, `updated_at`, `deleted_at` (borrado lógico)
  y `version`.
- Ninguna operación depende de tener red.

## Arquitectura de carpetas

```
app/                 # Rutas de Expo Router (pantallas delgadas)
src/
  domain/            # Lógica pura: dinero, división, saldos, liquidación (100% testeada)
  db/                # Esquema Drizzle, migraciones, repositorios
  features/<feature>/  # Componentes, hooks y lógica por funcionalidad
  ui/                # Sistema de diseño: componentes base y tokens
  i18n/              # Configuración y archivos de traducción
  lib/               # Utilidades (supabase, logger, etc.)
```

## Seguridad (valor central del proyecto)

- RLS en todas las tablas de Supabase: un usuario solo accede a los grupos donde es miembro.
- Nunca subir secretos al repo. Usar variables `EXPO_PUBLIC_*` solo para valores públicos
  (URL y anon key). La `service_role` key nunca va en la app.
- Tokens de sesión en `expo-secure-store`, no en AsyncStorage.
- Validar con zod toda entrada del usuario y todo dato que llegue de la red.
- Enlaces de invitación con token aleatorio, expirable y revocable.
- Al cerrar cada fase con cambios relevantes, ejecutar una revisión de seguridad del código.

## Skills a usar (si están disponibles en la sesión)

- `brainstorming` y `writing-plans`: antes de implementar una fase.
- `test-driven-development`: para todo `src/domain/` y la lógica de sincronización.
- `frontend-design` y `mobile-app-development` / `vercel-react-native-skills`: UI y rendimiento.
- `backend-api-database`: esquema, migraciones y políticas RLS.
- `security-code-review`: al cerrar cada fase con cambios de datos, auth o red.
- `verification-before-completion`: antes de declarar una fase terminada.

## Forma de trabajo en cada fase

1. Lee el código actual y este archivo. Propón un plan corto (modo plan) y espera aprobación.
2. Trabaja en una rama `fase-N-nombre`, con commits pequeños y mensajes claros en español.
3. Escribe pruebas junto con el código; las de `src/domain/` van primero (TDD).
4. Antes de cerrar, ejecuta y muestra la salida de: `npx tsc --noEmit`, `npm run lint`,
   `npm test -- --watchAll=false`.
5. Cierra con un resumen breve: qué se hizo, cómo probarlo en el teléfono, decisiones
   tomadas y pendientes para la siguiente fase. Actualiza el "Estado" de abajo.

## Pendientes técnicos

- **Rutas tipadas de Expo Router desactivadas.** En Windows, el generador incremental de
  `.expo/types/router.d.ts` compara rutas con `'../'` y registra archivos de `src/` como
  rutas, lo que rompe `tsc` mientras Metro corre. Reevaluar en una fase futura o al
  actualizar Expo (`experiments.typedRoutes` en `app.json`).
- **decode-uri-component vía Expo Router.** Llega a la app a través de `query-string` al
  interpretar enlaces y tiene un aviso de denegación de servicio con entradas mal
  codificadas. En la fase de invitaciones, limitar y validar con zod el tamaño y el formato
  de los enlaces antes de navegar.
- **Avisos de npm audit aceptados por ahora.** Seis paquetes de origen: braces, node-forge,
  sprintf-js, postcss-selector-parser y uuid viven en herramientas de build y desarrollo
  (Metro, Expo CLI, Tailwind y el prebuild de iOS) y no llegan al teléfono;
  decode-uri-component es el punto anterior. Ninguno se corrige sin `npm audit fix --force`,
  que rompería la alineación con Expo SDK 57. Revisar en cada actualización de SDK.
- **Skills de CLAUDE.md no sincronizadas.** Durante la implementación de la Fase 0 ninguna
  estaba disponible en la sesión y sus criterios se aplicaron a mano. Comprobar que estén
  disponibles al empezar la Fase 1.
- **Build nativo local desde OneDrive.** Gradle y CMake fallan porque las rutas superan el
  límite de Windows (`LongPathsEnabled` está en 0). Los development builds se hacen con
  EAS Build (`eas build --profile development --platform android`).

## Estado

- [x] Fase 0 — Limpieza y cimientos (rama `fase-0-limpieza-cimientos`, PR hacia `main` en revisión)
- [ ] Fase 1 — Motor de cálculo (dominio) y base de datos local
