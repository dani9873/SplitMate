# Fase 3 — Progreso

> Se actualiza con el commit de cada paso. Si una sesión se corta, se retoma desde
> "Siguiente paso". Tareas en `plan.md`; decisiones en `diseno.md`.

**Siguiente paso:** 12e.3, `db push` de `20261013143100_privilegios_authenticated.sql` con
permiso del usuario y repetir la prueba REST con `prueba1@splitmate.test`: crear y leer su
`profile`, no ver el de otro, y `anon` sin acceso.

## Pasos

- [x] Diseño y plan aprobados con los cuatro ajustes de la revisión (`a950b86`).
- [x] 1. Supabase local y esquema (`1e5ac04`).
- [x] 2. Seguridad y pruebas pgTAP: 123 pruebas en verde en PGlite; 12 mutaciones de la
      migración detectadas.
- [x] 3. Job de CI "Base de datos y RLS": verde al primer intento en el run 38182028758
      (`Files=6, Tests=123, Result: PASS`).
- [x] Punto de control: permiso para `supabase db push` al proyecto remoto (concedido el
      2026-10-12; el usuario escribe la contraseña).
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
- [x] Punto de control: lista de ajustes de Auth para el panel en `ajustes-panel.md` (aplicada
      por el usuario; el código de 30 minutos del paso 12c y sus plantillas, el 2026-10-12).
- [x] 9. Perfil remoto: upsert que ignora duplicados al entrar a `(app)`; sin red queda
      pendiente para el próximo arranque. 8 pruebas nuevas.
- [x] 10. Google (Android): módulo Kotlin con Credential Manager y nonce (lo encuentra el
      autolinking; se compila en el build de EAS de la tarea 12), `google.ts` y el botón en
      bienvenida y entrar. 20 pruebas nuevas. **Retirado en el paso 12e.1.**
- [x] Punto de control: pasos de Google Cloud y Supabase en `google-config.md` (pospuestos por
      el usuario; Google queda oculto sin `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`). **Retirado en el
      paso 12e.1.**
- [x] 11. Cuenta: cerrar sesión con dos opciones (la segunda advierte y borra los datos del
      teléfono) y borrar la cuenta con el correo exacto y luego contraseña o Google. Edge
      Function `delete-account` con `verify_jwt` y sesión de menos de 5 minutos; manejador
      probado en Jest. 649 pruebas en verde.
- [x] Punto de control: permiso para desplegar la Edge Function `delete-account` (concedido el
      2026-10-12).
- [ ] 12. Cierre:
  - [x] 12a. Verificaciones: tsc, lint, 649 pruebas, cobertura al 100 %, `check:bundle` y
        `expo-doctor` (21/21).
  - [x] 12b. Revisión de seguridad en `revision-seguridad.md`: 1 media, 2 bajas y 1 a
        verificar al desplegar.
  - [x] 12c. Los tres hallazgos corregidos: reautenticar sin cambiar de cuenta (`de720a2`),
        código de 30 minutos (`91bcc2f`) y la pantalla del nombre para Google sin nombre, con
        "Usuario" de respaldo y nunca el correo. 660 pruebas en verde.
  - [x] 12d. Desplegar:
    - [x] Proyecto vinculado (`supabase link`, sin contraseña) y `delete-account` desplegada
          (versión 1, `verify_jwt = true`).
    - [x] `verify_jwt` con ES256 comprobado de punta a punta: token válido 200 y usuario de
          prueba borrado; firma falsa 401 en el gateway. Detalle en `revision-seguridad.md`.
    - [x] `supabase db push` (el usuario, 2026-10-12): las dos migraciones aplicadas. Por REST
          con la clave publicable, las 8 tablas responden 401 `42501` (permission denied) a GET,
          y `profiles` también a POST; una tabla inexistente da 404 `PGRST205`. Las 8 existen y
          `anon` no tiene acceso.
    - [x] Panel (el usuario, 2026-10-12): Email OTP expiration en 1800 y las dos plantillas de
          30 minutos pegadas otra vez. **Corrección del 2026-10-13:** las plantillas no se pudieron
          pegar (el panel exige SMTP propio); quedan las predeterminadas. Ver 12e.2.
    - [x] La clave secreta de la prueba de `verify_jwt` no quedó en ningún historial: no hay
          `~/.bash_history`, y ni los dos historiales de PSReadLine ni las transcripciones de
          Claude Code la contienen (solo aparece la clave falsa de una prueba de Jest). No hace
          falta rotarla.
    - [x] `*.docx` y documentos personales sueltos en `.gitignore` y `.easignore` (`cb50fe6`).
  - [ ] 12e. Cambios de decisión del usuario (2026-10-13) y development build. Commit por paso:
    - [x] 1. Sin Google: fuera el módulo `splitmate-google-auth`, el botón, la pantalla del nombre
          (solo existía para Google), la reautenticación con Google, sus pruebas y textos,
          `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` y `google-config.md`. `AuthSession` ya no trae
          `providers`. Borrar la cuenta pide siempre la contraseña; si el correo ya es de otra
          cuenta, no sigue y cierra la sesión del teléfono (`sessionExpired`). CLAUDE.md: solo
          correo y contraseña; fuera los pendientes de Google, Sign in with Apple (la regla 4.8 solo
          aplica con inicio de sesión de terceros) y la SHA-1 del keystore. El proveedor ya estaba
          apagado en el proyecto (`/auth/v1/settings`: `google: false`).
    - [x] 2. Correos con la plantilla predeterminada (solo enlace). Comprobado con el código de
          Auth v2.197.0 (el del proyecto, por `/auth/v1/health`) y contra el proyecto: registro,
          reenvío y recuperación usan PKCE; un enlace válido vuelve con `?code=<uuid>`; uno usado o
          vencido, con el error en la consulta **y** repetido en el fragmento con `sb=`, que la app
          mandaba al inicio sin explicar nada (corregido). Supabase solo canjea el código 5 minutos
          después de pedir el correo (`flow_state_expired`), aunque el enlace confirme el correo:
          la pantalla del enlace lo explica según el último correo pedido (el servicio lo recuerda
          cifrado hasta entrar) y lleva a entrar o a pedir otro enlace con el correo escrito. "Revisa
          tu correo" ya no muestra el código (`EMAIL_HAS_CODE = false`); el registro ofrece "Ya
          confirmé mi correo". Plantillas propias en el repo (la de recuperación ahora dice que el
          botón sirve 5 minutos) y el pendiente de SMTP ampliado en CLAUDE.md. 658 pruebas en verde.
    - [ ] 3. Data API ("0 of 8 tables exposed"): por REST, con un usuario de prueba, que
          `authenticated` cree y lea su `profile` y que `anon` siga sin acceso. Si falta un permiso,
          migración solo para `authenticated` y preguntar antes de `db push`.
          **2026-10-13:** con `prueba1@splitmate.test` (creado y confirmado por el usuario en el
          panel; sin API de administración ni clave secreta), `anon` da 401 `42501` en las 8 tablas,
          pero `authenticated` también da 403 `42501` en las 8: sus GRANT no están, aunque
          `supabase migration list` muestra las dos migraciones aplicadas. Causa sin confirmar.
          Migración `20261013143100_privilegios_authenticated.sql`: solo `authenticated`, repite los
          GRANT de la de seguridad. En PGlite, 123 pgTAP en verde en base nueva y simulando el
          remoto (sin privilegios de `authenticated`: mismo `permission denied`, que la migración
          corrige). `db push --dry-run`: solo esa migración. Falta el permiso del usuario para el
          `db push` y repetir la prueba REST.
    - [x] 4. Panel (lo que se pueda leer): Redirect URL exacta `splitmate://auth/callback`, sin
          punto final, y OTP expiration 1800. Con un token falso en `/auth/v1/verify`, el
          `redirect_to` de la app vuelve a `splitmate://auth/callback` y `splitmate://otra/ruta`
          también (cae en la Site URL, que es la misma): la lista no tiene comodines. Con Site URL y
          lista iguales, un punto final en la lista no cambiaría nada. OTP expiration no se lee sin
          la API de gestión (la puso el usuario el 2026-10-12). Límite del proyecto: 2 correos por
          hora (dato del usuario).
    - [ ] 5. Variables `EXPO_PUBLIC_*` del perfil development en EAS (`eas env:create`, sin
          mostrar valores).
    - [ ] 6. Development build, enlace y pasos de prueba en el teléfono: registro, confirmación por
          enlace, entrar, abrir sin internet, cerrar sesión con ambas opciones y borrar la cuenta.
  - [ ] 12f. CLAUDE.md (Estado), push, PR y CI en verde.

## Notas para retomar

- **Correos del proyecto (12e.2):** plantillas predeterminadas de Supabase, solo el enlace y en
  inglés. Enlace válido → `splitmate://auth/callback?code=<uuid>`; usado o vencido (30 min) →
  `?error=access_denied&error_code=otp_expired&error_description=…#` + lo mismo + `&sb=`. El canje
  PKCE vence a los 5 minutos de pedir el correo. Se reproduce sin secretos ni efectos con
  `GET <url>/auth/v1/verify?token=pkce_<64 ceros>&type=signup&redirect_to=splitmate://auth/callback`
  (con el `apikey` publicable) y leyendo el `Location`.
- **Para probar en el teléfono:** el correo integrado tiene un límite de correos por hora
  (`email_sent = 2` en `config.toml`; confirmar el del proyecto en el paso 4). Registro, un
  reenvío y una recuperación pueden agotarlo.

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
- `supabase projects api-keys` enmascara la clave secreta nueva: para usarla en una prueba hace
  falta `--reveal`. Usarla solo dentro del comando, sin imprimirla ni guardarla.
- `supabase functions deploy --use-api` empaqueta en el servidor: no hace falta Docker.
