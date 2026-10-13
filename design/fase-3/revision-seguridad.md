# Fase 3 — Revisión de seguridad

Rama `fase-3-supabase-auth` contra `main`, hecha con la skill security-code-review el
2026-10-11, después del paso 11 (`d4f594e`).

> **Estado (2026-10-12):** los tres hallazgos están corregidos en el paso 12c. El medio está en
> `de720a2`, el código de 30 minutos en `91bcc2f` y el nombre en el commit que cierra el paso.
> El medio tiene un residuo aceptado: si la otra cuenta de Google no tenía cuenta en SplitMate,
> entrar con ella la crea, vacía, antes de que la app la descarte. `verify_jwt` quedó comprobado
> en el paso 12d (abajo).
>
> **2026-10-13:** Google se retiró de la app (paso 12e). El hallazgo medio y su residuo ya no
> aplican: borrar la cuenta pide siempre la contraseña del correo de la sesión.

## Resumen

No hay hallazgos críticos ni altos. Hay uno medio: al borrar una cuenta de Google, elegir otra
cuenta en la hoja de Google cambia la sesión. Eso borra la cuenta equivocada y los datos locales
de la correcta, que en esta fase son la única copia. Hay dos bajos y un punto para verificar al
desplegar la función.

## Hallazgos

### [MEDIO] Reautenticar con Google puede cambiar de cuenta antes de borrarla

- **Ubicación:** `src/features/auth/auth-service.ts:268-270` y
  `src/features/account/DeleteAccountScreen.tsx:67-76`.
- **Categoría:** OWASP A04 (diseño inseguro) / CWE-841.
- **Descripción:** `reauthenticateWithGoogle()` llama a `signInWithIdToken` con la cuenta que
  el usuario elija en la hoja de Google y no comprueba que sea la de la sesión. Si elige otra
  cuenta B, supabase-js reemplaza la sesión por la de B. Si B no existía en Supabase, la crea.
  `deleteAccount()` borra B. Después `wipeAccountData(session.userId)` borra la base local de la
  cuenta A, que sigue existiendo en Supabase.
- **Escenario:** un teléfono con dos cuentas de Google (personal y trabajo, o compartido en
  familia). El usuario elige la que no es. La cuenta A queda viva y la persona cree que la borró.
  Sus grupos se pierden porque todavía no se sincronizan. No da acceso a nada que el atacante no
  tuviera: quien tiene la cuenta B en el teléfono ya podía entrar con ella.
- **Corrección:**
  1. Antes de canjear: leer el claim `email` del ID token de Google, sin verificar la firma
     (solo como guarda de UX), y compararlo con `session.email`. Si no coincide, lanzar
     `AuthError('googleWrongAccount')` sin tocar la sesión.
  2. Después de canjear: comparar `data.user.id` con el `userId` esperado. Si no coincide,
     cerrar la sesión local y lanzar el mismo error. Es la red de seguridad que verifica el
     servidor.
  3. Texto es/en para el error y pruebas en `auth-service.test.ts` y `account.test.tsx`.

### [BAJO] Código de 6 dígitos válido por una hora

- **Ubicación:** `supabase/config.toml:239-241` (`otp_length = 6`, `otp_expiry = 3600`).
- **Categoría:** OWASP A07 / CWE-307.
- **Descripción:** son los valores por omisión de Supabase. El límite de
  `token_verifications = 30` cada 5 minutos es por IP, así que muchas IP juntas ganan más
  intentos dentro de la hora.
- **Corrección:** bajar `otp_expiry` a 1800 (o 900) aquí y en el panel (`ajustes-panel.md`).
  Hay que equilibrarlo con los correos que llegan tarde.

### [BAJO] El nombre del perfil puede mostrar parte del correo

- **Ubicación:** `src/features/auth/profile-sync.ts:11`.
- **Categoría:** CWE-359 (exposición de información privada).
- **Descripción:** sin nombre, el perfil usa la parte del correo antes de `@`, y los miembros de
  un grupo ven los perfiles de los demás. El comentario de `profiles` dice que el correo no se
  expone. Solo pasa con una cuenta de Google sin nombre, porque el registro lo exige.
- **Corrección:** usar un nombre genérico traducido ("Usuario") en vez de la parte del correo.

## A verificar

> **Resuelto el 2026-10-12 con la función desplegada.** El proyecto firma con ES256 (su JWKS
> publica una clave EC). El gateway rechaza un JWT ES256 con firma falsa
> (`UNAUTHORIZED_ASYMMETRIC_JWT`). Con un usuario de prueba desechable (`@example.com`, creado
> con la API de administración), un token ES256 válido y una sesión recién creada, la función
> respondió 200 `{"deleted":true}` y el usuario quedó borrado. `verify_jwt = true` se mantiene.
> Una petición sin `Authorization` (solo con la clave publicable en `apikey`) pasa el gateway, y
> el manejador la rechaza con 401. La clave secreta de la prueba solo vivió en una variable del
> comando: no quedó en los historiales de la terminal ni en las transcripciones, así que no hace
> falta rotarla.
>
> Con las migraciones aplicadas, `anon` recibe 401 `42501` (permission denied) en las 8 tablas
> del proyecto remoto, por REST con la clave publicable.

- **`verify_jwt` con claves de firma asimétricas.** El proyecto usa las claves nuevas
  (`sb_publishable_…`). Si también firma los JWT con claves asimétricas, comprobar al desplegar
  que el gateway acepta el token con `verify_jwt = true`. Si no lo acepta, todo borrado
  respondería 401. La seguridad no depende de esa opción: el manejador valida el token con
  `admin.auth.getUser`.

## Revisado sin hallazgos

- **Edge Function `delete-account`:** solo POST; Bearer con formato estricto; `getUser` en el
  servidor y `sub` igual al usuario; sesión de menos de 5 minutos por `amr`, que no cambia al
  renovar el token; errores sin detalles; la clave secreta solo en el entorno.
- **RLS y privilegios:** `anon` sin privilegios; sin DELETE ni TRUNCATE; UPDATE solo en columnas
  editables, nunca `user_id`, `role`, `group_id` ni `created_by`; funciones `SECURITY DEFINER`
  con `search_path = ''` en `private`; FKs compuestas por grupo; trigger de categoría como
  invocador; el alta del primer miembro solo para el creador de un grupo vacío.
- **Sesión en el teléfono:** AES-256-GCM con IV aleatorio y el nombre como AAD; clave en
  secure-store con `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`; un valor alterado se descarta.
- **PKCE y enlaces:** verificador con `getRandomValues` nativo y S256; un enlace con el código de
  otra persona no canjea sin su verificador. `+native-intent` deja pasar solo `auth/callback`
  validado con zod, con límite de largo, codificación rota rechazada y claves repetidas
  rechazadas. La pantalla vuelve a validar.
- **Google:** nonce de 32 bytes, Google recibe su SHA-256 y Supabase el original;
  `skip_nonce_check = false`.
- **Auth:** registro sin enumerar correos; confirmación obligatoria; `secure_password_change`;
  rotación del refresh token; sin registro anónimo ni vínculo manual; reautenticar con contraseña
  usa el correo de la sesión, no el que se escribe.
- **Base por cuenta:** `userId` validado como UUID antes de armar nombres de archivo o de clave;
  una base con otro dueño no se abre; borrar vacía el WAL y el SHM.
- **Secretos y registros:** sin secretos en el diff ni `.env` versionado; plantillas de correo
  sin datos del usuario renderizados; ningún registro con tokens, contraseñas ni correos.
- **Dependencias:** `npm audit --omit=dev` muestra los mismos seis avisos aceptados en CLAUDE.md;
  la fase no agrega ninguno.

## Fuera de alcance

- No hay gitleaks, semgrep ni osv-scanner en la PC: el barrido de secretos y patrones fue con
  grep.
- El módulo Kotlin y `expo-aes-gcm.ts` se revisaron leyendo el código. Se prueban en el
  emulador al cerrar la fase.
- La configuración del proyecto remoto (panel de Supabase y Google Cloud) depende de que se
  apliquen `ajustes-panel.md` y `google-config.md`.
