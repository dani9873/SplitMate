# Fase 3 — Diseño: cuentas y nube con Supabase

Aprobado el 2026-10-11 con cuatro ajustes de la revisión, ya incorporados: borrar la cuenta
con reautenticación y sesión reciente, cerrar sesión con la opción de borrar los datos del
teléfono, la lista de ajustes de Auth (versionados en `supabase/config.toml` cuando se
puede) y los pendientes nuevos en CLAUDE.md: MFA, CAPTCHA en el registro si hay abuso, Sign
in with Apple para iOS, SMTP propio antes de invitar a otras personas y la SHA-1 del keystore
de EAS para builds reales.

El avance paso a paso está en `progreso.md`.

## Objetivo

Login obligatorio con correo y Google, y la base de Postgres lista y segura para que la Fase 4
solo tenga que sincronizar. Todavía **no** se sincronizan gastos: la app autentica, crea su
`profile` y sigue trabajando sobre la base local de la cuenta.

## Decisiones

| Tema                    | Decisión                                                        | Alternativas descartadas                                                   |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Clave pública           | `sb_publishable_…`                                              | anon JWT: Supabase retira las claves legacy (anuncio: fines de 2026)       |
| Sesión                  | AES-256-GCM nativo de expo-crypto; clave en secure-store        | secure-store directo (límite de 2048 bytes); AES-CTR en JS; base SQLCipher |
| Google                  | Módulo Expo propio con Credential Manager y nonce; solo Android | `@react-native-google-signin` gratis: API obsoleta y sin nonce             |
| Datos por cuenta        | Una base SQLCipher por cuenta, con su clave                     | Una base con columna de dueño; vaciar la base al cambiar de cuenta         |
| Correos                 | Enlace PKCE a `splitmate://auth/callback` y código de 6 dígitos | Solo enlace (falla si se abre en otro dispositivo)                         |
| Borrar cuenta           | Edge Function con la API de administración, sesión reciente     | Función SQL que borre de `auth.users` (se salta la limpieza de Auth)       |
| Borrado de datos remoto | Solo borrado lógico (`deleted_at`); nadie tiene `DELETE`        | `DELETE` con políticas (un error de política borra datos de otros)         |

## Variables de entorno

| Variable                               | Valor                                 | Dónde                     |
| -------------------------------------- | ------------------------------------- | ------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`             | `https://<ref>.supabase.co`           | `.env` local (no se sube) |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`                    | `.env` local              |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`     | Id del cliente OAuth "Aplicación web" | `.env` local              |

- Se validan con zod al arrancar: URL `https` de Supabase y clave con el prefijo
  `sb_publishable_`. Si faltan, la app muestra un error de configuración, nunca un cierre.
- `.env.example` lista los nombres. `.gitignore` y `.easignore` excluyen todos los `.env`.
- El development build toma las variables de Metro. Un build con el bundle incluido
  (`preview`) necesitará variables de entorno de EAS; queda para cuando se use ese perfil.
- La clave secreta (`sb_secret_…` o `service_role`) nunca entra al repo ni a la app: solo
  existe en Supabase, como variable de la Edge Function.

## Sesión

### Almacenamiento

supabase-js guarda la sesión mediante un adaptador `getItem/setItem/removeItem`. El de
SplitMate cifra cada valor:

- **Algoritmo:** AES-256-GCM de `expo-crypto` (nativo: CryptoKit en iOS, `javax.crypto` en
  Android), con un IV aleatorio de 12 bytes por escritura y etiqueta de 16 bytes.
- **Clave:** 256 bits aleatorios en expo-secure-store (`splitmate.session.key.v1`), con
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: no viaja en respaldos ni a otros dispositivos.
- **Texto cifrado:** en el kv-store de expo-sqlite (`auth.<nombre>`), dentro de la carpeta de
  bases que ya está excluida del respaldo.
- **AAD:** el nombre de cada valor. Un texto cifrado copiado bajo otro nombre no descifra.
- **Fallas:** si un valor no descifra (alterado, o la clave se perdió), se borra y se trata
  como "sin sesión". Nunca se registra su contenido.

Por qué no secure-store directo: una sesión con Google (JWT, refresh token y el usuario con
sus identidades) supera con facilidad los 2048 bytes por valor que admite. Por qué no la base
SQLCipher: hay que saber de quién es la sesión **antes** de abrir la base de esa cuenta.

El cifrado se inyecta con una interfaz `SessionCipher { encrypt(texto, aad), decrypt(blob,
aad) }`: en la app la implementa expo-crypto y en las pruebas, `node:crypto` con el mismo
AES-256-GCM.

### Cliente y estado

- `createClient(url, clave, { auth: { storage, flowType: 'pkce', autoRefreshToken: true,
persistSession: true, detectSessionInUrl: false } })`.
- La renovación automática se pausa en segundo plano y se reanuda al volver (`AppState`).
- `AuthProvider` expone `restoring | signedOut | signedIn { userId, email, providers }`.
- **Sin red:** al arrancar, el estado sale de la sesión guardada (su `user.id`), no de una
  llamada a Supabase. Con una sesión guardada, la app entra a la base de esa cuenta aunque no
  haya conexión, y renueva el token cuando vuelve la red.
- Solo cierra la sesión por su cuenta si Supabase la rechaza de forma definitiva: refresh
  token revocado o inexistente, o la cuenta ya no existe.

## Datos locales por cuenta

### Una base por cuenta

- Cada cuenta abre su propio archivo SQLCipher con su propia clave en secure-store.
- Un **registro del dispositivo** (kv-store) apunta de cada `userId` a su archivo y su clave.
  La base de las Fases 1 y 2 (`splitmate.db`) conserva su nombre si la adopta una cuenta; las
  bases nuevas se llaman `account-<userId>.db`, con clave `splitmate.db.key.<userId>`.
- Cada base guarda su dueño en `local_settings` (`account.ownerId`). Al abrir, si el dueño no
  coincide con la sesión, la app no la abre: es la defensa contra mezclar cuentas aunque el
  registro falle.
- Las pantallas de la app viven en un grupo de rutas `(app)` cuyo layout abre la base de la
  cuenta. Al cerrar sesión ese layout se desmonta y la base se cierra.

### Usuario local → cuenta

En el primer login de una cuenta en el teléfono:

1. Si la cuenta ya está en el registro, se abre su base.
2. Si no, y existe la base de las Fases 1 y 2 sin dueño, la cuenta la **adopta**. En una
   transacción:
   - el usuario local (`profile.userId`, o el único `users` si faltaba ese ajuste) pasa a tener
     el id de la cuenta: se inserta el `users` nuevo, se actualizan `groups.created_by` y
     `group_members.user_id` y se borra el anterior;
   - su nombre y correo pasan a ser los de la cuenta;
   - se guardan `profile.userId` y `account.ownerId`.
     Después se agrega la cuenta al registro. Si algo se interrumpe, el siguiente intento repite
     la adopción sin duplicar: la transacción es atómica y cambiar el id es idempotente.
3. Si no, se crea `account-<userId>.db` con una clave nueva, su `users` y su dueño.

**Otra cuenta en el mismo teléfono:** como la base anterior ya tiene dueño, empieza con una
base vacía. Los datos de la primera cuenta quedan cifrados en el teléfono hasta que esa
cuenta vuelva a entrar. Nunca se mezclan.

Esto reemplaza la "adopción del usuario local" de la Fase 2 (pendiente de CLAUDE.md): con
cuenta, el usuario local siempre existe y su id es el de la cuenta.

### Cerrar sesión

Ajustes → Cerrar sesión ofrece dos opciones:

- **Cerrar sesión.** Revoca la sesión de este teléfono (`signOut({ scope: 'local' })`) y
  cierra la base. Los datos quedan cifrados en el teléfono para cuando vuelvas a entrar.
- **Cerrar sesión y borrar los datos de este teléfono.** Advierte que los datos todavía no se
  sincronizan y se perderán, y pide confirmarlo. Además de cerrar la sesión:
  1. pasa la base a `journal_mode = DELETE`, lo que vacía y elimina el WAL y el SHM;
  2. la cierra y borra el archivo (`deleteDatabaseSync`);
  3. borra su clave de secure-store y su entrada del registro.

Sin red, ambas opciones igual borran la sesión local; la revocación en el servidor se pierde,
y el refresh token queda inservible porque ya no está en el teléfono.

## Correos

- **Verificación y recuperación con PKCE.** El correo trae un botón al enlace de Supabase, que
  confirma y redirige a `splitmate://auth/callback?code=…`; la app canjea el código
  (`exchangeCodeForSession`).
- **Código de respaldo.** El mismo correo trae un código de 6 dígitos (`{{ .Token }}`). Sirve si
  el enlace se abre en otro dispositivo o la app de correo no abre la app:
  `verifyOtp({ email, token, type })`. Abrir el enlace en la computadora igual confirma el correo
  en el servidor; después basta con entrar con la contraseña.
- **Idioma.** Al registrarse, la app guarda `locale` en `user_metadata`. Las plantillas eligen el
  texto con `{{ if eq .Data.locale "en" }}`. Viven en `supabase/templates/` y
  `config.toml` las usa en local y en CI; en el panel se pegan a mano.
- **Envío.** El correo integrado de Supabase solo envía a miembros de la organización y unos
  pocos por hora: alcanza para probar. Antes de invitar a otras personas hace falta SMTP
  propio (pendiente en CLAUDE.md).

## Pantallas

```
(auth)                                  sin sesión
  index                                 Bienvenida: Google (Android), crear cuenta, entrar
  sign-up                               Crear cuenta: nombre, correo, contraseña
  sign-in                               Entrar: correo y contraseña, Google, ¿olvidaste…?
  check-email?flow=signup|recovery      Revisa tu correo: código de 6 dígitos y reenviar
  forgot-password                       Recuperar contraseña
auth/callback                           destino del enlace del correo (con o sin sesión)
reset-password                          Nueva contraseña (sesión de recuperación)
(app)                                   con sesión: las pantallas de las Fases 1 y 2
  (tabs)/settings                       + sección Cuenta: correo, cerrar sesión, borrar cuenta
```

- `Stack.Protected` elige `(auth)` o `(app)` según la sesión. Mover las pantallas a `(app)` no
  cambia sus URL.
- **Enlaces entrantes:** `+native-intent` recibe la URL cruda antes que Expo Router y la valida:
  como máximo 2048 caracteres, solo rutas conocidas y, en `auth/callback`, parámetros con zod
  (`code` de 1 a 256 caracteres seguros, o `error`, `error_code` y `error_description` acotados).
  Una URL inválida va al inicio. Resuelve el pendiente de decode-uri-component.
- **Validación con zod:**
  - nombre de 1 a 80 caracteres;
  - correo válido de hasta 254;
  - contraseña de 8 a 72 bytes (el máximo que acepta Supabase), sin reglas de composición;
  - código de 6 dígitos.
- **Mensajes que no revelan cuentas:**

  | Caso                                              | Mensaje                                                       |
  | ------------------------------------------------- | ------------------------------------------------------------- |
  | Correo o contraseña equivocados                   | "Correo o contraseña incorrectos."                            |
  | Recuperar con cualquier correo                    | "Si existe una cuenta con ese correo, te enviamos un enlace." |
  | Registrarse con un correo ya registrado           | La misma pantalla de "Revisa tu correo"                       |
  | Correo sin confirmar (con la contraseña correcta) | "Confirma tu correo" con la opción de reenviarlo              |
  | Demasiados intentos                               | "Demasiados intentos. Espera unos minutos."                   |
  | Sin conexión                                      | "Sin conexión. Revisa tu internet e intenta de nuevo."        |

- **Accesibilidad:** errores anunciados (`accessibilityLiveRegion`), autocompletado
  (`autoComplete="email"`, `"new-password"`, `"current-password"`, `"one-time-code"`), mostrar u
  ocultar la contraseña con nombre accesible, foco al primer error, áreas de 44 px y el teclado
  sin tapar los campos.
- **Reenviar** el correo tiene una espera de 60 segundos, igual que el límite de Supabase.

## Google (Android)

- Módulo local `modules/splitmate-google-auth` (Kotlin, Expo Modules) sobre Credential
  Manager: `GetSignInWithGoogleOption` (el flujo del botón) con `setNonce`, y
  `GoogleIdTokenCredential` para leer el ID token.
- **Nonce:** la app genera 32 bytes aleatorios (`raw`), pasa a Google su SHA-256 en hexadecimal y
  a Supabase el original: `signInWithIdToken({ provider: 'google', token, nonce: raw })`.
  Supabase compara el hash: un ID token robado no sirve para otra sesión.
- Errores del módulo: `CANCELED` (el usuario cerró la hoja: no se muestra nada), `NO_ACCOUNT`
  (sin cuentas de Google en el teléfono) y `FAILED`.
- En Google Cloud: un cliente OAuth "Aplicación web" (su id va en Supabase y en
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) y uno "Android" con el paquete y la SHA-1 del build.
- **iOS:** el botón no aparece. Exigiría Sign in with Apple (regla 4.8) y no podemos probarlo
  (pendiente en CLAUDE.md).

## Perfil

- Después de cada login, la app asegura su fila en `profiles` (insertar si falta). El nombre
  sale del registro (`user_metadata.display_name`) o de Google (`full_name`).
- Si no hay red, lo reintenta en el siguiente arranque. El `users` local ya tiene el id de la
  cuenta, así que nada local depende del perfil remoto.

## Borrar la cuenta

1. Ajustes → Borrar cuenta explica qué se borra:
   - tu cuenta y tu perfil en Supabase;
   - los datos de esta cuenta en este teléfono;
   - y, desde la Fase 4: los grupos donde no quede otro miembro con cuenta. En los
     compartidos, tu miembro queda como un nombre sin cuenta.
2. Pide escribir el correo de la cuenta.
3. **Reautenticación:** contraseña si la cuenta tiene identidad de correo; si solo tiene Google,
   volver a elegir la cuenta de Google. Ambas crean una sesión nueva.
4. La app llama a la Edge Function `delete-account` con esa sesión.
5. Si responde bien: cierra la sesión local y borra la base de la cuenta, su clave y su entrada
   del registro; vuelve a la bienvenida con un aviso.

### Edge Function `delete-account`

- `verify_jwt = true`: el gateway rechaza tokens inválidos antes de ejecutarla.
- El manejador, con dependencias inyectadas para probarlo:
  1. solo `POST`; otro método → 405;
  2. lee el `Bearer`; sin token → 401;
  3. valida el usuario con `auth.getUser(token)`; inválido, o `sub` distinto del usuario → 401;
  4. **sesión reciente:** el claim `amr` del token lista cómo y cuándo se autenticó la sesión.
     El más reciente debe tener 5 minutos o menos; si no → 403 `reauthentication_required`.
     Renovar el token conserva el `amr` original, así que una sesión vieja renovada no pasa;
  5. borra con `auth.admin.deleteUser(id)`; `profiles` cae en cascada;
  6. respuestas sin detalles internos; cualquier error → 500 genérico.
- La clave secreta la pone Supabase en el entorno de la función.

## Postgres

### Esquema (`supabase/migrations`)

Las mismas tablas que la base local, con los mismos ids UUID v7 generados en el cliente:

| Tabla            | Notas                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| `profiles`       | `id` = `auth.users.id` (borra en cascada), `display_name` 1–80. Sin correo |
| `groups`         | `created_by` → `profiles` (pasa a nulo si se borra la cuenta)              |
| `group_members`  | `user_id` → `profiles` (nulo = miembro sin cuenta); `role` owner/member    |
| `categories`     | predefinidas (`group_id` nulo, `key`) o del grupo (`name`)                 |
| `expenses`       | `kind`, montos, moneda, tasa, `occurred_on`, `category_id`                 |
| `expense_payers` | `group_id` derivado del gasto                                              |
| `expense_splits` | `group_id` derivado del gasto, `input_value`                               |
| `transfers`      | `from_member_id` ≠ `to_member_id`                                          |

- **Columnas comunes:** `created_at`, `updated_at` y `deleted_at` (`timestamptz`) y `version`
  (≥ 1). La base local guarda milisegundos; la sincronización convierte.
- **Tipos:**
  - montos `bigint` en unidades menores, de 1 a 99 999 999 999 999 (`> 0` o `≥ 0` según la
    columna, igual que en local), un tope que impide montos absurdos;
  - monedas `^[A-Z]{3}$`;
  - `occurred_on` y `rate_date` como `date` (día de calendario, sin zona);
  - la tasa como texto decimal (`^[0-9]+(\.[0-9]+)?$`, hasta 32 caracteres, mayor que cero).
- **CHECK:** las mismas longitudes, métodos de división, emoji, color y categorías que la base
  local.
- **Integridad entre grupos:**
  - `expense_payers`, `expense_splits` y `transfers` llevan `group_id`, y sus claves foráneas
    compuestas exigen que el gasto y los miembros sean de ese mismo grupo;
  - la categoría de un gasto es predefinida o del mismo grupo (trigger).
- **FKs:** dentro de un grupo, `ON DELETE CASCADE`; solo actúan en la limpieza de cuentas,
  porque la app no puede borrar filas.
- **Índices:** parciales sobre `deleted_at IS NULL`: por grupo, por grupo y fecha, el de un solo
  "yo" por grupo (`group_id, user_id`) y uno por `user_id` para las funciones de RLS.
- Las 9 categorías predefinidas se siembran con los mismos ids fijos.
- **Fase 4:** el cursor de sincronización (qué cambió desde la última vez) y la resolución de
  conflictos con `version`. Agregarlos es una migración pequeña.

### Seguridad

- **RLS** activado en todas las tablas de `public`. `anon` no tiene ningún privilegio.
  `authenticated` tiene `SELECT` e `INSERT` y `UPDATE` solo en columnas editables;
  `DELETE` y `TRUNCATE`, en ninguna.
- **Privilegios por omisión:** se revocan en `public` para `anon` y `authenticated`. Una tabla
  nueva no queda expuesta sin un `GRANT` explícito.
- **Funciones de apoyo** en el esquema `private`, que la API no expone. Todas son `SECURITY
DEFINER`, `STABLE`, con `search_path = ''` y nombres calificados; solo `authenticated` las
  ejecuta. Evitan que las políticas se consulten a sí mismas:
  - `private.is_group_member(group_id)`: hay un miembro activo con tu `user_id`;
  - `private.can_bootstrap_group(group_id)`: eres el creador y el grupo todavía no tiene
    miembros activos;
  - `private.shares_group_with(user_id)`: comparten algún grupo activo.
- **Políticas:**

  | Tabla                                                       | SELECT                              | INSERT                                                                        | UPDATE                       |
  | ----------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- | ---------------------------- |
  | `profiles`                                                  | el propio o quien comparte un grupo | solo `id = auth.uid()`                                                        | el propio                    |
  | `groups`                                                    | miembro                             | `created_by = auth.uid()`                                                     | miembro                      |
  | `group_members`                                             | miembro                             | miembro, con `user_id` nulo y rol `member`; o el creador, como primer miembro | miembro                      |
  | `categories`                                                | predefinidas, o miembro del grupo   | miembro, solo personalizadas                                                  | miembro, solo personalizadas |
  | `expenses`, `expense_payers`, `expense_splits`, `transfers` | miembro                             | miembro                                                                       | miembro                      |

- **Columnas que no se editan** (privilegios por columna): `id`, `group_id`, `created_by`,
  `user_id`, `role`, `key` y `created_at`. Cambiar `user_id` (vincular a otra persona o "soy yo")
  será una función RPC con sus reglas, en la fase de invitaciones o en la 4.
- **Borrar** es marcar `deleted_at` con `UPDATE`, como en local.
- **Revisiones pendientes para la Fase 4**, todavía solo en el cliente: grupo archivado de solo
  lectura, moneda bloqueada y bloqueo optimista con `version`.

### Pruebas pgTAP (`supabase/tests/database`)

- `000-setup`: funciones de prueba en un esquema `tests`:
  - crear un usuario en `auth.users` con su perfil;
  - autenticarse como él (`role authenticated` y `request.jwt.claims`).
- **Estructura:**
  - toda tabla de `public` tiene RLS;
  - `anon` no tiene privilegios;
  - nadie tiene `DELETE` ni `TRUNCATE`;
  - toda función `SECURITY DEFINER` fija su `search_path`.
- **Ajeno contra miembro**, por tabla: un usuario ajeno no lee, no inserta, no edita ni borra
  (borrado lógico) datos de un grupo; un miembro sí.
- **Suplantación:**
  - crear un grupo con `created_by` de otro;
  - insertar un miembro con el `user_id` de otro;
  - editar `user_id`, `created_by` o `role`;
  - agregarse a un grupo ajeno con o sin `user_id`;
  - crear el perfil de otro.
- **Integridad:** un pagador, una parte o una transferencia con miembros de otro grupo falla;
  una categoría de otro grupo, también.
- **Perfiles:** ves el tuyo y el de quien comparte un grupo, no el de un desconocido.

### CI

Un job nuevo, "Base de datos y RLS", en el workflow actual:

- `supabase/setup-cli` con la versión fija 2.120.0;
- `supabase db start` levanta solo Postgres con las migraciones;
- `supabase test db` corre pgTAP.

Corre en GitHub Actions porque en la PC no hay Docker.

## Configuración de Auth

`supabase/config.toml` versiona lo que se puede fijar, para el entorno local y el de CI:

- confirmación de correo obligatoria;
- largo mínimo de contraseña 8;
- duración del token de acceso 3600 s;
- rotación de refresh tokens con 10 s de reutilización;
- URL del sitio y redirecciones solo `splitmate://auth/callback`;
- límites de intentos;
- Google habilitado con `skip_nonce_check = false`; anónimos y el resto de proveedores
  apagados;
- plantillas de correo.

El proyecto remoto se configura en el panel, con la lista exacta que se entrega en el punto de
control de la tarea 8 del plan.
`supabase config push` podría aplicarla, pero escribe todo `[auth]` en el remoto: no se usa sin
permiso.

## Pruebas de la app

- **Almacenamiento de la sesión:**
  - ida y vuelta;
  - valor alterado o con otro AAD → se descarta y se borra;
  - sin clave → sin sesión;
  - sesión de más de 2048 bytes;
  - la clave se crea una sola vez.
- **Registro y bases por cuenta**, con sql.js y almacenes falsos:
  - adopción con cambio de id y referencias;
  - repetirla no duplica;
  - otra cuenta empieza vacía;
  - una base con otro dueño no se abre;
  - cerrar sesión y borrar elimina archivo, clave y registro.
- **Pantallas** con RNTL y un servicio de auth falso:
  - validación;
  - mensajes genéricos;
  - registro → revisa tu correo → código;
  - entrar;
  - recuperar → nueva contraseña;
  - las dos opciones de cerrar sesión;
  - borrar cuenta con correo y reautenticación por contraseña o por Google.
- **Errores de Supabase** traducidos, con un `fetch` falso que responde como Supabase.
- **Enlaces:** URLs largas, rutas desconocidas y parámetros inválidos van al inicio.
- **Google:** el nonce que recibe Google es el hash del que recibe Supabase; cancelar no muestra
  error.
- **Edge Function:**
  - 405, 401, sesión vieja → 403;
  - sesión reciente → borra y 200;
  - fallo al borrar → 500 sin detalles.
- **Flujo de la Fase 2:** sigue pasando, ahora con una sesión falsa.

## Fuera de alcance

Sincronización, invitaciones, RPC para vincular miembros, MFA, CAPTCHA, Sign in with Apple,
SMTP propio y builds de tienda (pendientes en CLAUDE.md).
