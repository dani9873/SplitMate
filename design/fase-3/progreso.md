# Fase 3 — Progreso

> Se actualiza con el commit de cada paso. Si una sesión se corta, se retoma desde
> "Siguiente paso". Tareas en `plan.md`; decisiones en `diseno.md`.

**Siguiente paso:** tarea 11, cuenta: cerrar sesión (dos opciones) y borrar la cuenta con
reautenticación; Edge Function `delete-account` con su manejador probado en Jest. Pendientes
del usuario: permiso y contraseña para `supabase db push`, los ajustes de `ajustes-panel.md` y
los de Google de `google-config.md`.

## Pasos

- [x] Diseño y plan aprobados con los cuatro ajustes de la revisión (`a950b86`).
- [x] 1. Supabase local y esquema (`1e5ac04`).
- [x] 2. Seguridad y pruebas pgTAP: 123 pruebas en verde en PGlite; 12 mutaciones de la
      migración detectadas.
- [x] 3. Job de CI "Base de datos y RLS": verde al primer intento en el run 38182028758
      (`Files=6, Tests=123, Result: PASS`).
- [ ] Punto de control: permiso para `supabase db push` al proyecto remoto (pedido; las
      tareas 4 a 7 no dependen de él).
- [x] 4. Almacenamiento cifrado de la sesión: 11 pruebas con node:crypto. El adaptador de
      expo-crypto (`expo-aes-gcm.ts`) se prueba en el emulador al cerrar la fase.
- [x] 5. Cliente, servicio y proveedor de auth: supabase-js 2.117.3, 48 pruebas nuevas con un
      servidor de Auth falso (`src/lib/supabase/test-utils.ts`).
- [x] 6. Base por cuenta: 13 pruebas con sql.js y un teléfono falso (archivos que solo abren
      con su clave, como SQLCipher), más el cierre de la base al desmontar.
- [x] 7. Rutas protegidas y enlaces: `Stack.Protected`, las pantallas de las Fases 1 y 2 en
      `(app)` (abre la base de la cuenta), bienvenida en `/welcome`, `+native-intent` con 27
      pruebas de enlaces, 4 de rutas protegidas y el flujo de la Fase 2 con sesión falsa.
- [x] 8. Pantallas de auth y plantillas: bienvenida, registro, entrar, revisa tu correo,
      recuperar, contraseña nueva y `auth/callback`; 25 pruebas nuevas; plantillas es/en y
      `[auth]` en `config.toml`.
- [x] Punto de control: lista de ajustes de Auth para el panel en `ajustes-panel.md` (falta
      que el usuario la aplique).
- [x] 9. Perfil remoto: upsert que ignora duplicados al entrar a `(app)`; sin red queda
      pendiente para el próximo arranque. 8 pruebas nuevas.
- [x] 10. Google (Android): módulo Kotlin con Credential Manager y nonce (lo encuentra el
      autolinking; se compila en el build de EAS de la tarea 12), `google.ts` y el botón en
      bienvenida y entrar. 20 pruebas nuevas.
- [x] Punto de control: pasos de Google Cloud y Supabase en `google-config.md` (falta que el
      usuario los aplique y ponga `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` en `.env`).
- [ ] 11. Cuenta: cerrar sesión y borrar cuenta.
- [ ] Punto de control: permiso para desplegar la Edge Function `delete-account`.
- [ ] 12. Cierre: verificaciones, revisión de seguridad, emulador, CLAUDE.md, PR y build.

## Notas para retomar

- En la PC no hay Docker. Para validar migraciones y pgTAP sin esperar al CI se usa PGlite
  (Postgres en WASM) en una carpeta temporal fuera de OneDrive:
  `npm i @electric-sql/pglite@0.5.8 @electric-sql/pglite-pgtap@0.0.9`, más un script que crea
  los roles `anon`, `authenticated` y `service_role`, el esquema `auth` con `auth.uid()`, los
  privilegios por omisión de Supabase en `public` y pgTAP en `extensions`; después aplica
  `supabase/migrations` y corre `supabase/tests/database` en orden. El CI es la fuente de
  verdad: PGlite usa Postgres 18 y Supabase, 17.
- Comprobado en PGlite: un trigger se dispara aunque el rol no tenga `EXECUTE` sobre su
  función, así que la función del trigger de categoría no necesita ese permiso.
- PKCE en auth-js 2.117: agregar `sb_flow_id` a la redirección es experimental y viene apagado.
  Se deja así: la redirección es exactamente `splitmate://auth/callback` (Supabase la compara
  con la lista permitida, query incluida) y el canje usa el verificador del último flujo.
  `exchangeCode` acepta un `flowId` por si un día llega en el enlace.
- Hermes no trae Web Crypto: `src/lib/supabase/web-crypto.ts` instala `getRandomValues` y
  `subtle.digest` (SHA-256) con expo-crypto, para que PKCE use S256 y un verificador aleatorio
  de verdad. No hay `importKey`: no usar `auth.getClaims()` en la app.
- Sin red, `signOut({ scope: 'local' })` de supabase-js no borra la sesión: el servicio la borra
  igual, como pide el diseño.
- En RNTL 14, `render` y `act` son asíncronos: `await render(...)`.
- expo-sqlite comparte la conexión de un mismo archivo (conteo de referencias) y no borra una
  base abierta; `deleteDatabaseSync` borra solo el archivo, sin WAL ni SHM. Por eso
  `deleteAccountData` cierra primero la base abierta de esa cuenta y pasa a
  `journal_mode = DELETE` antes de borrar.
- Nombres fijos por cuenta (`account-<userId>.db`, clave `splitmate.db.key.<userId>`): si el
  registro del dispositivo se pierde, la cuenta igual encuentra su base. La base de las Fases
  1 y 2 se detecta por su clave en el almacén seguro.
- La sesión cifrada y el registro de cuentas comparten el kv-store `splitmate-device.db`.
- La bienvenida vive en `/welcome`, no en `/`: `(auth)` y `(app)` no comparten URL. Sin sesión,
  `Stack.Protected` lleva de `/` a la bienvenida (lo prueba `protected-routes.test.tsx`).
- `renderRouter` con temporizadores falsos de Jest se cuelga: usar `waitFor` con los reales.
- Un Metro viejo (`expo start --port 8083`) bloqueaba renombrar carpetas de `app/`: se detuvo.
- Recuperar la contraseña: `signIn(session, { recovery: true })` deja disponible solo
  `reset-password`; `finishRecovery()` pasa a `(app)`. Sin navegar a mano.
- Sin sesión, `router.replace('/')` no navega (la ruta está protegida): ir a `/welcome`.
- Las preferencias aplican el idioma del dispositivo al hidratarse, a mitad de la primera prueba
  de un archivo: las pruebas con `renderRouter` simulan un teléfono en español.
- Plantillas de correo: `{{ if eq (print .Data.locale) "en" }}`; sin `print`, una cuenta sin
  `locale` rompería la plantilla.
- `secure_password_change` activado (no estaba en la lista del diseño): la app solo cambia la
  contraseña con la sesión recién creada por el correo de recuperación.
