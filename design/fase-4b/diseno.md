# Fase 4b — Diseño: invitaciones, acceso por membresía y descarga por páginas

Propuesta del 2026-10-17, pendiente de aprobación. Tres decisiones las tomó el usuario:

1. **Dominio propio comprado.** Sirve para los enlaces https verificados y para el remitente del
   correo. En este documento se escribe `<dominio>` hasta que exista.
2. **Enlace reutilizable, como Tricount.** Cualquier cuenta con acceso crea el enlace. Vence en 7 días,
   admite hasta 10 usos y se puede revocar. Quien entra recibe el rol `member`.
3. **Realtime fuera de la 4b.**

El avance paso a paso se lleva en `progreso.md` y las tareas están en `plan.md`. El modelo de
sincronización y RLS es el de `design/fase-4a/diseno.md`. Aquí solo se describe lo que cambia.

## Objetivo

Compartir un grupo con otras personas. Alguien recibe un enlace, entra a la app, dice quién es entre
los miembros del grupo y desde ese momento ve y edita el grupo como los demás. Para eso, el acceso
deja de depender de ser el creador del grupo y pasa a depender de una membresía que se puede quitar.
La descarga queda con topes, porque un grupo compartido puede crecer mucho.

**Fuera de alcance:** Realtime (sección d, queda para una 4c), la pantalla de historial con
`change_log`, los perfiles de otras cuentas (a las personas se las nombra por su miembro, nunca por su
correo), los Universal Links de iOS (necesitan cuenta de Apple; mientras tanto, en iOS el enlace se
pega en la app o se abre con el esquema), MFA y CAPTCHA.

## Resumen de decisiones

| Tema                                  | Decisión                                                                                                                                             | Alternativas descartadas                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quién tiene acceso                    | Tabla `group_access`: una fila por cuenta y grupo, con rol `owner` o `member`, separada de `group_members` (las personas que aparecen en los gastos) | Acceso solo por miembro vinculado: rompe los grupos sin «yo». Mantener al creador con una bandera de «expulsado»: dos fuentes de verdad para el acceso        |
| Token                                 | 32 bytes aleatorios del servidor, en base64url (43 caracteres). En la base se guarda solo su SHA-256                                                 | Token elegido por el cliente: su calidad depende del teléfono. Código corto para escribirlo a mano: se puede adivinar por fuerza bruta                        |
| Enlace                                | `https://<dominio>/i#<token>`, verificado como App Link en Android. Página de respaldo estática en Cloudflare Pages                                  | Solo esquema propio: no se puede tocar en WhatsApp y cualquier app puede registrarlo. Servicio de enlaces de terceros: más datos fuera y otra dependencia     |
| Tabla de invitaciones                 | `private.group_invitations`, fuera de la Data API, con RPC `SECURITY DEFINER` pequeñas                                                               | Tabla en `public` con RLS: quien acepta todavía no tiene acceso, así que igual haría falta una RPC privilegiada, y el hash quedaría a un `GRANT` de exponerse |
| Usos                                  | Reutilizable: 7 días y 10 usos por omisión (de 1 hora a 30 días y de 1 a 50 usos), revocable                                                         | Un solo uso: hay que crear un enlace por persona (decisión del usuario)                                                                                       |
| Abuso                                 | Topes por cuenta (enlaces creados, intentos fallidos) y por grupo (enlaces activos, cuentas) en una tabla de eventos                                 | Sin límites: con 256 bits no se adivina un token, pero sí se puede saturar la base y enumerar respuestas                                                      |
| Compatibilidad                        | `sync_pull_v2` nueva. `sync_pull` sigue igual hasta que los dos teléfonos tengan la app de la 4b y luego se borra                                    | Cambiar `sync_pull`: la app instalada rechazaría filas de una tabla que no conoce y dejaría de sincronizar                                                    |
| Página de descarga de un grupo grande | Se pide por páginas dentro del grupo con un tope fijo (`hw`) y la app junta las páginas en una tabla local antes de aplicar                          | Solo poner cupos: limita el peor caso, pero todavía en decenas de MB. Aplicar cada página por separado: un hijo puede llegar antes que su padre               |
| Perder el acceso                      | El grupo queda en el teléfono como copia de solo lectura, con un aviso. El usuario decide si lo quita                                                | Borrarlo enseguida: se pierden cambios sin subir, y la 4a prometió que nada se borra solo                                                                     |
| Realtime                              | Fuera de la 4b                                                                                                                                       | Aviso por Broadcast en esta fase: suma websocket, políticas en `realtime.messages` y pruebas del remoto a una fase que ya es grande                           |

## a) Invitaciones por enlace

### Cómo se usa

1. En el detalle del grupo, **Invitar** crea un enlace y abre la hoja de compartir del sistema. La
   duración se elige entre 1 día, 7 días (por omisión) y 30 días. Los usos son 10.
2. La persona invitada toca el enlace. Si tiene la app, se abre en **Unirte a «Viaje»**. Si no inició
   sesión, primero entra o se registra y después vuelve a esa pantalla.
3. La pantalla muestra el nombre, el emoji y la moneda del grupo, y pregunta **¿Quién eres?**. Ofrece
   los miembros sin cuenta y **Soy alguien nuevo** (con su nombre).
4. Al aceptar, la cuenta recibe acceso como `member`, queda vinculada a ese miembro y la app descarga
   el grupo completo (cursor en 0).

Crear un enlace y unirse son las únicas acciones que necesitan red: el token lo genera el servidor.
Sin conexión, el botón explica que hace falta internet. Todo lo demás sigue funcionando offline.

### Token

- `extensions.gen_random_bytes(32)` en base64url sin relleno: 43 caracteres de `[A-Za-z0-9_-]`.
- La base guarda `sha256(token)` con índice único. Se busca por hash. Si la base se filtra, los
  enlaces no sirven.
- El token se ve una sola vez, en la respuesta de `create_invitation`. El teléfono que lo creó lo
  guarda en su base local cifrada (`invitation_links`, sin sincronizar) para **Compartir de nuevo**.
  Los demás teléfonos ven el enlace en la lista, pero solo pueden crear uno nuevo.
- Nunca va a los registros, ni en la app ni en el servidor.

### Enlace y deep link

- **Formato:** `https://<dominio>/i#<token>`. El token va en el fragmento (`#`), que el navegador no
  envía al servidor: si se abre la página de respaldo, el token no queda en registros ni en el
  `Referer`.
- **Android:** App Link verificado. En `app.json` se agrega un `intentFilter` con `autoVerify` para
  `https://<dominio>/i`. En `https://<dominio>/.well-known/assetlinks.json` va el paquete con las
  huellas SHA-256 de los dos keystores de EAS (development y preview, que firman distinto), que se
  obtienen con `eas credentials`.
- **iOS:** sin cuenta de Apple no hay Universal Links. Quedan **Unirme con un enlace** (pegarlo en la
  app) y el botón de la página de respaldo, que abre el esquema propio de la app. Cuando haya cuenta,
  se suman `associatedDomains` y `apple-app-site-association`.
- **Página de respaldo** (`web/links/` en el repo, desplegada a mano en Cloudflare Pages): la abre
  quien toca el enlace sin tener la app o desde un navegador que no la abre. Tiene **Abrir en
  SplitMate** (esquema propio con el token en el fragmento), **Copiar enlace** y una línea que dice
  que la app todavía no está en las tiendas y que se le pida a quien invitó. Es HTML estático, sin
  analítica ni recursos de terceros, con CSP estricta y `Referrer-Policy: no-referrer` en `_headers`.
  No es la versión web de la app, que sigue fuera del alcance.
- **Validación antes de navegar** (pendiente de `decode-uri-component`): `app/+native-intent.tsx`
  (`redirectSystemPath`) revisa cada URL que entra antes de que Expo Router la interprete. Un esquema
  zod pide largo ≤ 256, host `<dominio>` o el esquema propio, ruta `/i` y token
  `^[A-Za-z0-9_-]{43}$`. Si cumple, navega a `/invite` con el token en memoria. Si no, va al
  inicio. Los enlaces de Auth de la Fase 3 pasan por la misma función y se prueba que sigan
  funcionando.
- **Sin sesión:** el token se guarda en `expo-secure-store` con la hora y vence en 1 hora (cubre el
  registro con confirmación por correo). Después de entrar, se usa y se borra.

### Tabla `private.group_invitations`

| Columna                    | Qué guarda                                                          |
| -------------------------- | ------------------------------------------------------------------- |
| `id`                       | `uuid` del servidor (las filas las crea solo la RPC)                |
| `group_id`                 | FK a `groups`, `on delete cascade`                                  |
| `token_hash`               | `bytea`, único                                                      |
| `created_by`               | `auth.uid()`, FK a `profiles` `on delete cascade`                   |
| `created_at`, `expires_at` | `expires_at` va de 1 hora a 30 días después de `created_at` (CHECK) |
| `max_uses`, `use_count`    | `max_uses` de 1 a 50 y `use_count` de 0 a `max_uses` (CHECK)        |
| `revoked_at`, `revoked_by` | Nulos mientras no se revoque                                        |

Sin privilegios para `anon`, `authenticated` ni `service_role`: está en `private` y solo la tocan las
RPC.

### RPC

Todas en `public`, `SECURITY DEFINER` (quien acepta todavía no tiene acceso y RLS le ocultaría el
grupo), `set search_path = ''`, `revoke all ... from public, anon, authenticated, service_role` y
`grant execute ... to authenticated`. Cada una empieza por comprobar que `auth.uid()` no sea nulo y
revisa el acceso de forma explícita: con `DEFINER`, RLS no protege nada.

| RPC                                                                                                       | Qué hace                                                                                                                                                                                | Quién                                              |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `create_invitation(p_group_id uuid, p_expires_hours int default 168, p_max_uses int default 10) → jsonb`  | Crea el enlace y devuelve `{ id, token, expires_at, max_uses }`                                                                                                                         | Una cuenta con acceso activo a un grupo no borrado |
| `preview_invitation(p_token text) → jsonb`                                                                | Devuelve `{ group: { id, name, emoji, color, currency }, members: [{ id, display_name }], accounts, expires_at, already_member }`: solo los miembros activos sin cuenta, y ningún monto | Cualquier cuenta con el token                      |
| `accept_invitation(p_token text, p_member_id uuid default null, p_new_member jsonb default null) → jsonb` | Da acceso y vincula. Devuelve `{ group_id }`                                                                                                                                            | Cualquier cuenta con el token                      |
| `revoke_invitation(p_invitation_id uuid) → void`                                                          | Marca `revoked_at`. Repetirla no cambia nada                                                                                                                                            | Quien creó el enlace o el dueño del grupo          |
| `list_invitations(p_group_id uuid) → jsonb`                                                               | Enlaces activos y los vencidos o revocados en los últimos 7 días: `id`, `created_by`, `created_at`, `expires_at`, `max_uses`, `use_count`, `revoked_at`. Nunca el token ni el hash      | Una cuenta con acceso                              |

**`accept_invitation` paso a paso**, en una transacción:

1. Valida el formato del token, busca por hash y bloquea la invitación (`FOR UPDATE`), así dos
   aceptaciones a la vez no pasan de `max_uses`.
2. Revisa el estado: no revocada, no vencida, con usos libres y con el grupo sin borrar.
3. Si la cuenta ya tiene acceso activo, devuelve `{ group_id }` sin gastar un uso y sin tocar el
   miembro: así un reintento no hace nada nuevo.
4. Bloquea el contador del grupo (`private.next_change_seq`, como `sync_push`). Revisa el cupo de 50
   cuentas por grupo y el de 200 grupos por cuenta.
5. Hace una sola de dos cosas:
   - con `p_member_id`, vincula un miembro activo sin cuenta (si ya tiene una, `SMTKN`);
   - con `p_new_member` (`{ id, display_name }`, con un `id` UUID v7 del cliente), crea el miembro con
     las mismas validaciones de `sync_push`.
6. Inserta la fila de `group_access` con rol `member`, o reactiva la que tenía si ya había estado.
   Suma 1 a `use_count`.
7. Escribe en `change_log` con `private.record_change`: el acceso (`access`, `create` o `restore`) y
   el miembro.

Las escrituras pasan por el trigger de columnas del servidor, así que reciben `change_seq` y llegan a
los demás por la sincronización. La función corre como dueña (`postgres`), y la guardia de la 4a no
la frena.

**Errores** (5 caracteres, como `SMCUR`). Ajuste del 2026-10-17: `preview_invitation` y
`accept_invitation` responden **el mismo `SMINV`** para un token inexistente, vencido, revocado o
agotado, así no se puede saber desde fuera si un token existió. Los códigos `SMEXP`, `SMREV` y `SMFUL`
quedan como estado interno (lo que muestra `list_invitations` a quien administra el enlace) y para las
pruebas:

| Código  | Cuándo                                       | Qué ve el usuario                                                           |
| ------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `SMINV` | Token mal formado o que no existe            | «Este enlace no es válido.»                                                 |
| `SMEXP` | Vencido                                      | «Este enlace venció. Pide uno nuevo.»                                       |
| `SMREV` | Revocado                                     | «Este enlace ya no está activo. Pide uno nuevo.»                            |
| `SMFUL` | Sin usos libres                              | «Este enlace ya se usó todas las veces permitidas.»                         |
| `SMGFL` | Grupo con 50 cuentas o cuenta con 200 grupos | «El grupo llegó al máximo de personas.» / «Llegaste al máximo de grupos.»   |
| `SMTKN` | Ese miembro ya tiene cuenta                  | Vuelve a cargar la vista previa: «Alguien ya eligió a Ana. Elige de nuevo.» |
| `SMRLT` | Demasiados intentos o enlaces                | «Demasiados intentos. Prueba de nuevo en una hora.»                         |

### Límites contra el abuso

Se guardan en `private.rate_events (user_id, action, created_at)`. Cada RPC borra al pasar los eventos
de más de 1 día.

| Qué                                                                                        | Tope                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Intentos fallidos (`SMINV`, `SMEXP`, `SMREV`, `SMFUL`) en `preview` y `accept`, por cuenta | 10 por hora. Al pasarlo, `SMRLT` incluso con un token válido |
| Enlaces creados por cuenta                                                                 | 20 por día                                                   |
| Enlaces activos por grupo                                                                  | 20                                                           |
| Cuentas con acceso por grupo                                                               | 50                                                           |
| Grupos con acceso por cuenta                                                               | 200                                                          |
| `p_expires_hours`, `p_max_uses`                                                            | 1 a 720 y 1 a 50 (`22023` si se pasan)                       |

Para que un intento fallido cuente, `preview_invitation` y `accept_invitation` no lanzan los errores
de la tabla anterior. Responden `{ "error": "SMINV" }` con estado 200, así la transacción confirma
el evento. Si lanzaran el error, PostgREST desharía la transacción entera, evento incluido, y el
tope no serviría de nada. Los errores de programación (`22023`, `42501`) sí se lanzan.

## b) Acceso del creador pasado a membresía

### `public.group_access`

| Columna                                                           | Qué guarda                                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                                                              | `uuid` del servidor (solo la escriben triggers y RPC)                                  |
| `group_id`, `user_id`                                             | Únicos juntos. FK a `groups` (`cascade`) y a `profiles` (`cascade`)                    |
| `role`                                                            | `owner` o `member`. Hay exactamente un `owner` activo por grupo (índice único parcial) |
| `invitation_id`                                                   | Por qué invitación entró. Nulo para el creador y para las filas del relleno            |
| `created_at`, `updated_at`, `deleted_at`, `version`, `change_seq` | Como las demás tablas de grupo. `deleted_at` con valor quiere decir «sin acceso»       |

- **Se sincroniza** como octava tabla de grupo, pero solo de bajada. `authenticated` tiene `SELECT`
  con RLS (`can_access_group`) y ningún `INSERT` ni `UPDATE`. `sync_push` no la acepta.
- La autoridad del dueño sale de aquí. `group_members.role` queda por compatibilidad y ya no decide
  permisos.
- Ninguna fila expone correos ni perfiles: en la app, una cuenta se muestra por el miembro al que está
  vinculada.

### Acceso en RLS

- `private.can_access_group(g)` pasa a ser: existe una fila activa de `group_access` para
  `(g, auth.uid())`. El creador deja de tener acceso por ser el creador.
- `groups` sigue necesitando ver la fila en el mismo `INSERT ... RETURNING` que la crea, que es el
  motivo por el que la 4a compara `created_by`. La política queda así: `can_access_group(id) or
(created_by = auth.uid() and not private.group_has_access_rows(id))`. La segunda parte solo vale
  para un grupo que todavía no tiene ninguna fila de acceso, es decir, en el instante de crearlo. Un
  creador expulsado tiene su fila con `deleted_at`, así que no entra por ninguna de las dos. Se prueba
  con pgTAP.
- Un trigger `AFTER INSERT` en `groups` (`SECURITY DEFINER`) crea la fila `owner` de `created_by`.

### Permisos

| Acción                                                      | Quién                                                                                   | Si no                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Ver y editar movimientos, miembros y categorías, y archivar | Cualquier cuenta con acceso                                                             | RLS                                                                  |
| Crear un enlace                                             | Cualquier cuenta con acceso                                                             | `forbidden`                                                          |
| Revocar un enlace                                           | Quien lo creó o el dueño                                                                | `forbidden`                                                          |
| Borrar o restaurar el grupo                                 | Solo el dueño                                                                           | `failed: forbidden` (la app no ofrece la acción)                     |
| Quitar el acceso a otra cuenta                              | Solo el dueño, y nunca a sí mismo                                                       | `forbidden`                                                          |
| Salir del grupo                                             | Cualquier cuenta menos la última. Si sale el dueño, el rol pasa a la cuenta más antigua | `SMLST`: «Eres la única persona con acceso. Puedes borrar el grupo.» |
| Vincular «soy yo»                                           | Solo la propia cuenta, sobre un miembro sin cuenta                                      | Reglas de la 4a                                                      |
| Desvincular el propio «soy yo»                              | La propia cuenta (antes daba `forbidden` a quien no era el creador)                     | —                                                                    |
| Borrar un miembro vinculado a una cuenta con acceso         | Nadie: primero se le quita el acceso                                                    | `rejected: member_linked`, con borrador                              |

`member_linked` es `rejected` y no `failed` porque hay una carrera real: alguien puede borrar a Ana sin
conexión mientras Ana se une con su enlace.

**RPC nuevas** (`SECURITY DEFINER`, mismas reglas que las de invitaciones):

- `leave_group(p_group_id)`: marca su acceso como borrado y desvincula su miembro (el miembro queda en
  los movimientos).
- `remove_access(p_group_id, p_user_id)`: hace lo mismo con otra cuenta. Solo la llama el dueño.

Las dos escriben en `change_log` y usan el contador del grupo.

### Migrar los grupos existentes

Todo va en una sola migración, en una transacción, así que nunca hay un momento en que RLS niegue algo
que antes dejaba:

1. Crear `group_access` con sus índices, su trigger de columnas, RLS y privilegios.
2. Relleno: una fila `owner` por grupo con `created_by` (también los borrados, para poder
   restaurarlos), y una fila `member` por cada `(group_id, user_id)` de miembros vinculados activos
   que no sean el creador.
3. Reemplazar `can_access_group`, la política de `groups`, las reglas de `group_members` y el trigger
   de borrar la cuenta.
4. Un grupo sin `created_by` ni miembros vinculados queda sin acceso. No debería haber ninguno (la 4a
   los borra al borrar la cuenta). La migración avisa con `raise notice` cuántos encontró.
5. El relleno es **idempotente** (`ON CONFLICT DO NOTHING`): correrlo dos veces no duplica filas. Se
   prueba en pgTAP con un grupo con creador, uno con varios miembros y uno borrado lógicamente.

**La sincronización no se rompe:**

- Las filas del relleno pasan por el trigger de columnas, reciben `change_seq` y llegan a la app nueva
  como cualquier cambio.
- La app de la 4a usa `sync_pull`, que no cambia y no devuelve `group_access` (se prueba con pgTAP).
  `sync_push` sigue igual, salvo las reglas nuevas.
- Con la app vieja, un rechazo nuevo (`member_linked`, `quota`) aparece como «error». Pasa solo
  durante la transición, con las cuentas del usuario.

### Perder el acceso en el teléfono

- `sync_pull_v2` devuelve `lost`: los grupos de `p_cursors` que la cuenta ya no ve, por expulsión,
  por salida desde otro teléfono o por borrado definitivo.
- En la app, ese grupo recibe `access_lost_at`: queda de solo lectura, con el aviso «Ya no tienes
  acceso a este grupo. Esta es la última copia de este teléfono.» y **Quitar de este teléfono**.
- Sus cambios sin subir no se borran ni se envían. La hoja de sincronización los cuenta aparte: «N
  cambios no se subirán: ya no tienes acceso».
- Si la cuenta vuelve con otra invitación: se limpia `access_lost_at` y el cursor vuelve a 0. Lo
  pendiente se envía con sus bases viejas y, si choca, queda como borrador (reglas de la 4a).

### Borrar la cuenta con grupos compartidos

El trigger de `profiles` de la 4a cambia su criterio a «sin otra cuenta con acceso activo»:

- **Grupos sin otra cuenta:** se borran, como hoy.
- **Grupos compartidos:** se quita su acceso, su miembro queda sin cuenta (el `SET NULL` que ya existe)
  y, si era dueña, el rol pasa a la cuenta activa más antigua. Sus gastos se quedan.

La pantalla de borrar la cuenta lo explica: «Tus grupos compartidos siguen para los demás, sin tu
cuenta».

### En la app

- **Base local, migración 0005** (`--custom`, con su SQL dentro):
  - la tabla `group_access`, de solo bajada;
  - la columna `groups.access_lost_at`;
  - la tabla `invitation_links`;
  - la tabla `sync_pull_pages` (sección e);
  - filas mínimas en `users` para las cuentas ajenas que aparecen en `created_by` y `user_id`: solo el
    id, marcadas como remotas. Así las FK locales siguen valiendo sin reconstruir tablas. Al
    implementar se confirman las columnas obligatorias de `users`.
- **Miembros:** marca «tú», «tiene cuenta» y «dueño». El dueño ve **Quitar acceso**. Todos ven **Salir
  del grupo**. **Borrar grupo** solo se muestra al dueño.
- **Enlaces:** en el detalle del grupo, **Invitar** y la lista de enlaces (vence, usos, quién lo creó,
  **Revocar**).

## c) SMTP propio con Brevo: pasos manuales

Son pasos tuyos, en los paneles. Yo no toco el remoto. Las credenciales SMTP viven solo en el panel de
Supabase y en tu gestor de contraseñas: nunca en `.env`, en EAS ni en el repo.

1. **Dominio.** Cómpralo en Cloudflare Registrar: cobra el precio de costo, y el DNS y Pages quedan en
   la misma cuenta.
2. **Brevo, cuenta y dominio.** Crea la cuenta (plan gratuito, 300 correos por día). Entra en
   _Senders, Domains & Dedicated IPs → Domains → Add a domain_ con `<dominio>`. Copia en el DNS de
   Cloudflare los registros que muestra: el TXT de verificación de Brevo, DKIM y DMARC (empieza con
   `v=DMARC1; p=none; rua=mailto:<tu correo>`). Pulsa _Authenticate_ hasta que los tres queden en
   verde.
3. **Remitente.** En _Senders_, agrega `no-reply@<dominio>` con el nombre «SplitMate».
4. **Clave SMTP.** En _SMTP & API → SMTP_, genera una clave llamada `supabase`. Anota el servidor
   `smtp-relay.brevo.com`, el puerto `587` y el usuario (con forma `…@smtp-brevo.com`). La clave se
   ve una sola vez.
5. **Seguimiento.** Si Brevo tiene activo el seguimiento de clics en los correos transaccionales,
   apágalo: reescribe los enlaces y puede romper los de confirmación y recuperación.
6. **Supabase → Authentication → Emails → SMTP Settings.** Activa _Enable custom SMTP_ y completa:
   remitente `no-reply@<dominio>`, nombre `SplitMate`, host `smtp-relay.brevo.com`, puerto `587`,
   usuario y clave del paso 4, e intervalo mínimo de 60 s. Guarda.
7. **Supabase → Authentication → Rate Limits.** Sube _Rate limit for sending emails_ de 2 a 30 por
   hora.
8. **Plantillas.** Pega las de `supabase/templates` según `design/fase-3/ajustes-panel.md`, sección 5.
9. **Prueba.** Pide una recuperación de contraseña a tu correo. En Gmail, abre _Mostrar original_:
   SPF, DKIM y DMARC deben decir `PASS`.
10. **Avísame.** Yo paso `EMAIL_HAS_CODE` a `true` en `src/features/auth/auth-service.ts` (es código,
    no una variable). Va en el build del cierre.

**Lo que cambia:** ninguna variable de entorno. `EMAIL_HAS_CODE` pasa a `true`. `<dominio>` aparece
en `app.json` y en una constante de la app: es un valor público. Las URL de Auth (_URL
Configuration_) no cambian, porque los enlaces de correo siguen con el esquema de la Fase 3.

Con esto se pueden hacer las dos pruebas manuales de la Fase 3 que siguen pendientes. Conviene
hacerlas antes de invitar a otra persona.

**Cloudflare Pages, para la página de respaldo.** También son pasos tuyos:

1. Crea un proyecto Pages llamado `splitmate-links`, con subida directa de la carpeta `web/links` (sin
   build).
2. En _Custom domains_, agrega `<dominio>`.
3. Comprueba que `https://<dominio>/.well-known/assetlinks.json` responda con
   `Content-Type: application/json`.

## d) Realtime

**Fuera de la 4b** (decisión del usuario).

- **Qué daría:** ver en segundos lo que otra persona registra, sin volver a abrir la app.
- **Por qué se espera:** la 4b ya cambia el acceso, el protocolo de descarga y suma invitaciones.
  Realtime agrega un websocket, Realtime Authorization con políticas en `realtime.messages`,
  configuración del remoto y pruebas con dos cuentas. Mientras tanto, la app se pone al día al
  abrirla, al volver a ella, después de cada escritura y con **Sincronizar ahora**, que en un grupo
  de amigos es suficiente.
- **Cómo entraría en una 4c:** un trigger hace `realtime.send` a un canal privado `group:<id>` con
  solo `{ "seq": N }`, y la app, mientras está en primer plano, pide un ciclo. Los datos siguen
  llegando solo por `sync_pull_v2`, que valida y aplica cada grupo completo. Realtime solo avisa,
  nunca trae datos. Las políticas del canal reusan `can_access_group`.

## e) S3: tope de filas por página en `sync_pull_v2`

### Servidor

`sync_pull_v2(p_cursors jsonb, p_max_rows integer default 1000) → jsonb`, `SECURITY INVOKER` y
`STABLE`, como la 4a, con estos cambios:

- **Tope duro:** `p_max_rows` va de 100 a 2000 (antes, hasta 5000). La respuesta nunca trae más
  filas, ni siquiera para un grupo solo.
- **Un grupo grande se pide por páginas.** Si los cambios de un grupo no caben, sale solo y
  `partial: true`, con `next`. La app manda ese `next` en su cursor:

  ```json
  { "<grupo>": { "seq": 0, "hw": 900, "after": { "t": 3, "id": "<uuid>" } } }
  ```

  - `seq`: el cursor confirmado.
  - `hw` (_high water_): el `change_seq` del grupo al pedir la primera página. Fija lo que entra en
    esta descarga.
  - `after`: dónde terminó la página anterior. `t` es la posición de la tabla en el orden padre → hijo
    (grupo, acceso, miembros, categorías, gastos, pagadores, partes, transferencias).
  - Las páginas traen las filas con `seq < change_seq ≤ hw`, ordenadas por `(t, id)` desde `after`.
    Al terminar, `cursor = hw`.

- **Por qué `hw`:** una fila que cambia mientras se descargan las páginas queda con un `change_seq`
  mayor que `hw`. No entra en estas páginas y llega en la ronda siguiente. Sin ese tope, una fila
  editada detrás de la posición ya leída quedaría por debajo del cursor final y no llegaría nunca.
- Los grupos pequeños se siguen juntando enteros en una página, como en la 4a. Un número entero en
  el cursor (`"<grupo>": 57`) sigue siendo válido.
- La respuesta suma `lost` (sección b).
- **Cupos**, revisados en `sync_push` al crear, con `rejected: quota` y la unidad como borrador:

  | Cupo                                                    | Tope    |
  | ------------------------------------------------------- | ------- |
  | Grupos con acceso por cuenta (al crear o al unirse)     | 200     |
  | Miembros por grupo, borrados incluidos                  | 200     |
  | Categorías personalizadas por grupo                     | 100     |
  | Gastos más transferencias por grupo, borrados incluidos | 20 000  |
  | Pagadores y partes por gasto                            | 50 (4a) |

  **Compromiso conocido:** las categorías borradas cuentan para el cupo de 100 (como los miembros y
  los movimientos, borrar no libera cupo). Se eligió lo más estricto contra el abuso; con 100 es
  difícil que moleste. La respuesta de un cupo lleno es `rejected / quota` con el campo `quota`
  (`groups`, `members`, `categories` o `movements`).

  Los conteos usan los índices `(group_id, change_seq)` que ya existen. Si en las pruebas resultan
  lentos, se pasan a contadores en `private.group_changes`.

### Cliente (C5)

- Pide páginas de 1000 filas. Rechaza con zod una respuesta que traiga más filas que `p_max_rows`,
  más grupos que los que pidió, textos más largos que los límites del servidor o un `next` mal
  formado: el estado pasa a «error».
- Las páginas de un grupo parcial se guardan en `sync_pull_pages` (SQLite, en la base cifrada), no en
  memoria. Cuando llega la última, la app hace una ronda más desde `hw` (casi siempre vacía) para
  traer lo que cambió mientras bajaba. Después aplica todo junto en una transacción con
  `defer_foreign_keys`, igual que la 4a.
- Esa ronda extra cubre un caso: un miembro editado durante la descarga queda por encima de `hw` y no
  viene en las páginas, pero un gasto de las páginas lo necesita. Si aun así falla una FK, se descartan
  las páginas, el cursor no avanza y se reintenta en el siguiente ciclo (regla de la 4a).
- **C4**, que con grupos compartidos deja de ser teórico: al aplicar una fila, si su `id` ya existe en
  el teléfono con otro `group_id`, o una parte o un pagador con otro `expense_id`, no se aplica y el
  estado pasa a «error». El servidor nunca cambia esos campos, así que una diferencia indica un dato
  corrupto o malicioso.

### Retiro de `sync_pull` (v1)

Sigue igual mientras los dos teléfonos tengan la app de la 4a. Cuando los dos tengan el build de la
4b, una migración la borra: es el último `db push` de la fase. Hasta entonces, S3 sigue abierto para
la app vieja.

## f) Bloqueo de doble toque a ~300 ms

- `Button` e `IconButton` (`src/ui`) bajan su ventana de 500 ms a 300 ms, con una sola constante
  compartida. 300 ms sigue tapando el doble toque accidental (dos toques en menos de 250 ms), y un
  segundo toque intencional ya no se pierde.
- Pruebas con temporizadores falsos, para los dos componentes: el segundo toque a los 299 ms se
  ignora y a los 300 ms se acepta. Las pruebas de 500 ms que existan se actualizan.

## Seguridad

- Funciones `SECURITY DEFINER` nuevas: `create_invitation`, `preview_invitation`,
  `accept_invitation`, `revoke_invitation`, `list_invitations`, `leave_group`, `remove_access` y el
  trigger del dueño. Cada una lleva `search_path = ''`, nombres con esquema, `auth.uid()` revisado y
  `revoke` / `grant` exactos en su migración.
- Cada migración actualiza `001-estructura` y `006-privilegios`. `check:data-api` suma estas pruebas:
  - `anon` no ejecuta ninguna RPC nueva y no lee `group_access` (401 `42501`);
  - `authenticated`:
    - con un token inventado recibe `SMINV`;
    - lee `group_access` (vacía para `prueba1`);
    - no le escribe;
    - no ve `private.group_invitations`.
- Los tokens se guardan con hash y van en el fragmento. No se registran. Solo los ve quien creó el
  enlace.
- Los topes de abuso y los cupos se prueban uno por uno con pgTAP.
- Toda URL que entra se valida con zod antes de llegar al router.
- Al cerrar: `detect_changes`, la skill security-code-review y `check:data-api` contra el remoto.

## Pruebas

- **pgTAP** (`supabase/tests/database`):
  - `012-acceso`:
    - el relleno (dueño y miembros);
    - el creador expulsado sin acceso, ni siquiera a la fila de `groups`;
    - el `INSERT ... RETURNING` del creador;
    - el dueño único;
    - la tabla de permisos completa;
    - `leave_group` y `remove_access`;
    - `member_linked`;
    - la propia desvinculación;
  - `013-invitaciones`:
    - crear, ver, aceptar (con miembro existente y con miembro nuevo), revocar y listar;
    - token inválido, vencido, revocado y agotado;
    - dos aceptaciones al mismo tiempo sobre el último uso;
    - aceptar dos veces sin gastar un uso;
    - `SMTKN`;
    - cada tope y `SMRLT`;
    - `change_log`;
    - el hash nunca sale;
  - `014-sync-pull-v2`:
    - páginas dentro de un grupo con `p_max_rows` chico;
    - `hw` con una fila que cambia entre páginas;
    - cursores enteros y con `next`;
    - `lost`;
    - `group_access` incluida;
    - cada límite;
    - v1 sin cambios y sin `group_access`;
  - `015-cupos`: cada cupo de la tabla;
  - se ajustan:
    - `007` y `008` (acceso por membresía);
    - `010` (v1 sigue igual);
    - `011` (grupos compartidos al borrar la cuenta);
    - `001` y `006`.
- **Motor con TDD**, en Jest contra PGlite, con tres cuentas (A dueña, B invitada, C ajena) y dos
  dispositivos:
  - B se une y descarga completo;
  - los cambios de A y B convergen;
  - C no ve nada;
  - A expulsa a B con cambios sin subir: el grupo de B queda de solo lectura y no se pierde nada;
  - B vuelve con otra invitación y lo pendiente se envía o queda como borrador;
  - descarga por páginas con un `p_max_rows` chico y la ronda extra desde `hw`;
  - C4 y C5;
  - borrar la cuenta de A con el grupo compartido.
- **Enlaces:** `+native-intent` con URL válidas, largas, mal codificadas, de otro host y de Auth de la
  Fase 3, y el token pendiente con vencimiento.
- **Pantallas** con RNTL:
  - unirse (vista previa, «¿Quién eres?», cada error);
  - invitar, compartir de nuevo y revocar;
  - miembros con sus marcas y acciones;
  - el grupo con acceso perdido.
- **`Button` e `IconButton`:** la ventana de 300 ms.
- **En el teléfono, al cierre:**
  - el S24 con la cuenta A y el Poco con la cuenta B, que usa un correo real (requiere el SMTP);
  - el enlace se comparte por WhatsApp y se abre como App Link;
  - B se une eligiendo un miembro;
  - los dos registran gastos;
  - A revoca el enlace y B prueba otro;
  - A quita el acceso a B y B lo vuelve a obtener;
  - B sale del grupo;
  - la página de respaldo, en un navegador sin la app.

## Pendientes para después

- Realtime como aviso (4c).
- Universal Links en iOS cuando haya cuenta de Apple.
- La pantalla de historial con `change_log` («quién cambió qué»).
- Transferir el rol de dueño a mano (en la 4b solo pasa al salir o al borrar la cuenta).
- Purgar `private.sync_mutations` y `private.rate_events` con un trabajo programado, si crecen.
- Pendientes de la revisión 4a que esta fase no toca: C6, K2, K3 y pg_graphql.
