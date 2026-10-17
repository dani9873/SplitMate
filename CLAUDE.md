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
- Login obligatorio con correo y contraseña. Sin Google ni otros proveedores (decisión del
  2026-10-13).
- Multidioma: cualquier idioma vía archivos de traducción. Inicialmente `es` y `en`.
- Modo claro y oscuro.

## Stack y decisiones fijas

| Área | Decisión |
|---|---|
| Base | Expo (última versión estable de SDK), Expo Router, TypeScript `strict` |
| Estilos | NativeWind (Tailwind) con tokens de diseño propios; dark mode por `colorScheme` |
| Datos locales | SQLite en el dispositivo (`expo-sqlite`) + Drizzle ORM. **Fuente de verdad local** |
| Nube | Supabase: Postgres, Auth (solo correo y contraseña), Storage, Row Level Security |
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
- Migraciones locales (drizzle-kit): cada `.sql` es un módulo propio para Metro y Jest
  (`scripts/sql-module.js`). No volver a `babel-plugin-inline-import`, aunque lo sugiera la guía de
  Drizzle: Metro servía un `.sql` viejo desde su caché y la app se cerraba
  (`design/fase-3/crash-migracion-0003.md`). Una migración `--custom` lleva su SQL antes de abrir
  la app: un trozo sin SQL da `MIGRATION_INVALID`.

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
- Toda migración que cree una tabla, función o secuencia en `public` trae en el mismo archivo sus
  GRANT explícitos (solo a los roles que la usan, nunca a `anon`), RLS y políticas, y actualiza
  `001-estructura` y `006-privilegios`. El proyecto no expone nada nuevo por omisión.
- Los privilegios cambian solo por migraciones, nunca desde el panel: desactivar la exposición
  automática en Data API revocó también los de las tablas existentes
  (`design/fase-3/data-api-privilegios.md`). Después de cada `supabase db push`,
  `npm run check:data-api` debe pasar (usuario de prueba `prueba1@splitmate.test`; la contraseña la
  da el usuario y solo va en la variable de entorno o en el aviso del script).

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
6. Cuando el usuario confirme que probó la fase en su teléfono y el CI esté en verde, haz
   merge del PR con merge commit sin volver a preguntar.
7. Toda la comunicación con el usuario, los planes, los PR y los commits van en español.
8. Para no perder avance si la sesión se corta: commit al terminar cada paso del plan, aunque
   sea pequeño, y `design/fase-N/progreso.md` al día, con la lista de pasos (los terminados
   con `[x]`) y una línea de "Siguiente paso". Al retomar, se empieza por ese archivo.

## Pendientes técnicos

- **Dos pruebas manuales de la Fase 3, antes de probar la Fase 4 con otra persona.** El límite de
  correos del proyecto (2 por hora) las dejó fuera de la prueba del teléfono del 2026-10-14:
  1. Registro nuevo con un correo real y confirmación por enlace: el enlace abre la app y entra.
     Si pasaron más de 5 minutos, la pantalla dice que el correo quedó confirmado y lleva a entrar.
     Si se usa el mismo correo de la prueba anterior, borrar antes esa cuenta desde la app.
  2. Recuperar la contraseña: llega el correo, el enlace abre "contraseña nueva", y después la
     nueva sirve para entrar y la anterior no.

  La caída al abrir un enlace ya se verificó con un enlace simulado
  (`design/fase-3/crash-migracion-0003.md`).
- **Fase 4b: acceso del creador.** Desde la Fase 4a, el creador de un grupo siempre tiene acceso a
  él en RLS (`private.can_access_group`), aunque no tenga un miembro vinculado: así se suben los
  grupos sin "yo". Cuando existan invitaciones y expulsiones, el acceso debe pasar a depender de la
  membresía, o un creador expulsado seguiría viendo el grupo (`design/fase-4a/diseno.md`).
  Hasta entonces, el creador lee, edita y borra todo el grupo, agrega `owner` y puede borrar a
  cualquier miembro, y cualquier miembro activo puede borrar a otro (lo deja sin acceso). Además, un
  miembro que no es el creador no puede desvincular su "soy yo" ni borrarse: da `forbidden`.
  Detalle en `design/fase-4a/revision-seguridad.md`.
- **Pendientes de la revisión de seguridad de la Fase 4a** (`design/fase-4a/revision-seguridad.md`):
  - `sync_pull` sin tope de filas por grupo ni cupos de grupos o filas (S3), y la página sin tope en
    el cliente (C5);
  - el cliente aplica por `id` sin comparar grupo ni gasto (C4);
  - borradores de conflicto de grupos que ya no están (C6);
  - valorar bloquear `ACCESS_WIFI_STATE` de expo-network (K2, con build);
  - fijar las acciones del CI por SHA (K3);
  - revisar en el panel si pg_graphql está activo y apagarlo si no se usa.
- **Sincronización: S3, `sync_pull` sin tope por grupo.** Un grupo con muchísimas filas se baja
  entero en una página (el primero entra siempre), y no hay cupos de grupos ni de filas por cuenta.
  Poner topes y cupos en el servidor y en el cliente antes de abrir la app a más personas (detalle
  en `design/fase-4a/revision-seguridad.md`, S3 y C5).
- **Cambiar la contraseña de `prueba1@splitmate.test`.** Es la cuenta de `npm run check:data-api`;
  la contraseña se usó en las pruebas de la Fase 4a. Cambiarla (la da el usuario; no va en el repo).
- **Fila «Un cambio por subir» sin reproducir.** En la prueba del teléfono apareció esa fila en la
  hoja de sincronización con un borrador por revisar; con el motor real y PGlite no se reprodujo
  (los conteos salieron correctos; lo que sí fallaba era el texto de la cabecera, ya corregido). Si vuelve a
  verse en el S24 o el Poco, anotar los pasos exactos y mirar `counts()` en ese momento.
- **Decimal con punto de `es-419`.** El español usa `es-419` para números y fechas (punto decimal,
  coma de miles, `FORMAT_LOCALES` en `src/i18n/locale.ts`). Si se suman otros países
  hispanohablantes (Colombia, España, México…), revisar esa tabla: algunos usan coma decimal.
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
- **Skills de CLAUDE.md: resuelto.** No estaban sincronizadas durante la Fase 0. Desde su cierre
  están disponibles, y en la Fase 1 se usaron brainstorming, writing-plans,
  test-driven-development, backend-api-database, security-code-review y
  verification-before-completion. En la Fase 2 se sumaron frontend-design,
  mobile-app-development y vercel-react-native-skills.
- **Build nativo local desde OneDrive.** Gradle y CMake fallan porque las rutas superan el
  límite de Windows (`LongPathsEnabled` está en 0). Los development builds se hacen con
  EAS Build (`eas build --profile development --platform android`).
- **Exclusión del respaldo: falta compilarla en iOS.** La base y su WAL quedan fuera del
  respaldo. En Android, `allowBackup` en `false` más las reglas de
  `plugins/with-backup-rules.js`. En iOS, el módulo local `modules/splitmate-backup` marca la
  carpeta con `isExcludedFromBackup`. Ese módulo en Swift todavía no se compiló: verificarlo
  en el próximo build de iOS, que puede ser un build de simulador en EAS sin cuenta de Apple.
- **Datos de ejemplo solo en desarrollo.** La pantalla `/dev` se retiró en la Fase 2. Queda el
  botón "Cargar datos de ejemplo" en Ajustes, solo en desarrollo; `npm run check:bundle`
  verifica en CI que ese módulo no llegue a producción.
- **Encabezados fijos de FlashList.** FlashList 2.0.2, la versión que fija Expo SDK 57,
  muestra un encabezado fijo con el día equivocado tras borrar o restaurar un movimiento,
  hasta desplazar la lista. El historial usa encabezados dentro de la lista. Reevaluar los
  fijos cuando Expo actualice FlashList.
- **Adopción del usuario local.** Sin perfil local, elegir "soy yo" sobre un miembro ya
  vinculado a un usuario de este dispositivo adopta ese usuario como el local (datos
  anteriores al perfil). Con el login, reemplazarlo por la asociación de la cuenta; un miembro
  vinculado a otra persona ya se rechaza con `MEMBER_TAKEN`.
- **Maestro fuera de CI.** El flujo E2E de `.maestro/` corre en local contra el development
  build y Metro (instrucciones en `.maestro/README.md`); en CI haría falta un emulador.
- **Foco automático dentro de las hojas.** En Android, el campo para renombrar un miembro
  recibe el foco al abrir la hoja, pero el teclado no se abre solo dentro del Modal: hay que
  tocar el campo. Revisarlo cuando otra hoja necesite escribir apenas se abre.
- **service_role sin privilegios en el remoto.** El panel le quitó los de las 8 tablas y no se
  devolvieron: las migraciones le dan lectura y escritura sin DELETE ni TRUNCATE, y el remoto, nada.
  Hoy no afecta (`delete-account` solo usa `auth.admin`). En la fase de sincronización, quitárselos
  también en una migración (privilegio mínimo, repo igual al remoto) o devolvérselos si un proceso
  del servidor los necesita.
- **MFA.** Supabase Auth admite un segundo factor (TOTP). Ofrecerlo en Ajustes, al menos
  como opción, antes de la publicación.
- **CAPTCHA en el registro si hay abuso.** Supabase admite hCaptcha y Cloudflare Turnstile en
  registro, inicio de sesión y recuperación. Activarlo si aparecen registros automatizados;
  hasta entonces bastan los límites de intentos de Auth.
- **SMTP propio antes de invitar a otras personas.** El correo integrado de Supabase solo
  envía a miembros de la organización y unos pocos por hora. Antes de que otras personas se
  registren, configurar un proveedor SMTP (Resend, Brevo u otro) y subir el límite de envíos.
  Sin SMTP, el panel no deja editar las plantillas: los correos son los predeterminados (solo el
  enlace, en inglés) y la app no muestra el campo del código. Con SMTP, pegar las plantillas de
  `supabase/templates` (es/en, enlace y código de 6 dígitos; pasos en
  `design/fase-3/ajustes-panel.md`, sección 5), pasar `EMAIL_HAS_CODE` a `true` en
  `src/features/auth/auth-service.ts` y hacer un build nuevo. El código cubre lo que el enlace no:
  abrirlo en otro dispositivo o después de los 5 minutos en que Supabase canjea el enlace PKCE.

## Estado

- [x] Fase 0 — Limpieza y cimientos (PR #1 integrado en `main`)
- [x] Fase 1 — Motor de cálculo (dominio) y base de datos local (PR #2 integrado en `main`)
- [x] Fase 2 — Pantallas del MVP: grupos, miembros, gastos, ingresos, transferencias, saldos y actividad (PR #3 integrado en `main`)
- [x] Fase 3 — Cuentas y nube con Supabase: login obligatorio, esquema en Postgres con RLS, sin sincronizar todavía (PR #4 integrado en `main`; antes de probar la Fase 4 con otra persona, las dos pruebas manuales de "Pendientes técnicos")
- [x] Fase 4a — Sincronización offline-first (PR #5 integrado en `main`): servidor, motor, pantallas, correcciones tras la prueba en el teléfono y toques repetidos. **COMPLETA**, verificada en el teléfono (S24 Ultra y Poco X3) y con el CI en verde.
- [ ] Fase 4b — Pendientes: invitaciones por enlace; SMTP propio para el correo; acceso del creador pasado a membresía; Realtime; S3 (`sync_pull` sin tope por grupo, cupos); cambiar la contraseña de `prueba1@splitmate.test`. Detalle en "Pendientes técnicos".

## Exploración de código

- Usa primero el grafo (`get_architecture`, `search_graph`, `trace_path`, `get_code_snippet`) antes de Grep o de leer archivos completos.
- Lee el archivo real antes de editar o de afirmar que algo no existe o no tiene llamadores.
- Usa `detect_changes` antes de la revisión de seguridad al cerrar una fase.
- Si el índice parece viejo tras cambiar de rama, vuelve a correr `index_repository`.
