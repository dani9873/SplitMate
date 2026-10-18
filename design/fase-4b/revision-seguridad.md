# Fase 4b — Revisión de seguridad

## Paso 5: invitaciones en el servidor (2026-10-19)

### Alcance y método

Migración `20261019090000_invitaciones.sql` (tablas `private.group_invitations` y `private.rate_events`,
cinco RPC `SECURITY DEFINER`, `release_access` y `remove_access` nuevas) y `check:data-api`. Revisión
manual por categoría (OWASP A01, A02, A04, A07, A09), trazando cada ruta de entrada a escritura, y
pgTAP `013-invitaciones` (159 pruebas) como evidencia. No hay secretos nuevos ni dependencias nuevas
(se suma `pgcrypto`, extensión de Supabase ya instalada en `extensions`).

**No hay hallazgos críticos ni altos.** Ninguna ruta da acceso a un grupo sin un token válido, ni
deja leer el token o su hash.

### Condiciones de seguridad del plan, con su evidencia

| Condición | Cómo se cumple | Prueba |
|---|---|---|
| Contador de usos atómico | `private.claim_invitation_use`: un solo `UPDATE ... SET use_count = use_count + 1 WHERE use_count < max_uses AND revoked_at IS NULL AND expires_at > now()`. Antes se bloquea el contador del grupo y luego la invitación (`FOR UPDATE`), en el mismo orden que `leave_group`, `remove_access` y `revoke_invitation`. El `CHECK use_count <= max_uses` es una segunda barrera. | Dos cuentas, un cupo (la segunda recibe `SMINV`); tres reclamaciones de un enlace de 2 usos; la función contiene el `UPDATE` condicionado |
| Mismo error | Inexistente, mal formado, nulo, larguísimo, vencido, revocado, agotado y de grupo borrado dan `{"error":"SMINV"}` con estado 200, en `preview` y en `accept` | `count(distinct j) = 1` sobre los ocho casos |
| Vista previa mínima y con límite | Solo con sesión; devuelve grupo (id, nombre, emoji, color, moneda), miembros sin cuenta (id y nombre), conteo de cuentas, vencimiento y `already_member`; 10 intentos fallidos por hora | Claves exactas de la respuesta; `SMRLT` con token válido; no suma eventos estando bloqueado |
| Token fuera de registros | Solo sale en la respuesta de `create_invitation`. La base guarda `sha256(token)`; el historial, `group_access` y las respuestas de error no lo contienen; los errores de negocio se responden, no se lanzan | Pruebas de `change_log`, `group_access`, respuesta de error y de la lista |

### Hallazgos y estado

| Id | Sev. | Hallazgo | Estado |
|---|---|---|---|
| I1 | Media | Quien era expulsado volvía a entrar con cualquier enlace vigente que hubiera visto en el grupo (solo se revocaban los suyos al salir). | **Corregido con TDD** en la misma migración: `remove_access` revoca todos los enlaces vigentes del grupo (`013`, 4 pruebas nuevas). Salir por voluntad propia solo revoca los de quien sale. |
| I2 | Baja | Un miembro puede crear 20 enlaces al día y llenar el tope de 20 activos del grupo: otros no pueden crear hasta que se revoquen. | Aceptado: los miembros son de confianza y el dueño revoca cualquier enlace (`revoke_invitation`). |
| I3 | Baja | `private.rate_events` solo se purga por cuenta cuando esa cuenta llama; si deja de usar la app, sus eventos viejos se quedan. | Aceptado; ya en pendientes del diseño («purgar con un trabajo programado, si crecen»). |
| I4 | Baja | Los topes de intentos son por cuenta: quien tenga muchas cuentas multiplica los intentos. Con 256 bits de token, adivinar es inviable; el tope solo frena la saturación y el sondeo. | Aceptado. El registro ya tiene límites de Auth; CAPTCHA queda en pendientes. |
| I5 | Baja | Un error de programación lanzado por `accept_invitation` (22023, o una violación de clave de una cuenta sin perfil) viaja a PostgREST con el cuerpo de la petición, que contiene el token. Postgres no registra los parámetros si `log_parameter_max_length_on_error` es 0 (su valor por omisión). | **A verificar en el panel** (mañana): que esa opción siga en 0. Los argumentos se validan antes que el token y el cliente los valida con zod, así que solo ocurre por un cliente defectuoso. |
| I6 | Info | `SMTKN` y `SMGFL` requieren un token válido, así que no son un oráculo sobre tokens. No cuentan como intento fallido, a propósito. | Sin acción |
| I7 | Info | `list_invitations` expone el `created_by` (id de cuenta) a los miembros del grupo, como pide el diseño; la app lo muestra por el nombre del miembro vinculado. | Sin acción |

### Revisado y sin hallazgos

- **Privilegios:** las cinco RPC con `revoke ... from public, anon, authenticated, service_role` y
  `grant execute` solo a `authenticated`; las funciones de apoyo sin `EXECUTE` para nadie; las dos
  tablas de `private` con RLS activado, sin políticas y sin privilegios (`006`, `001` y `013`).
  `search_path` vacío en todas.
- **Bloqueos:** orden único contador del grupo → invitación; sin interbloqueo con `release_access`.
- **Aceptación repetida:** devuelve `{ group_id }` sin gastar uso ni escribir historial.
- **Cupos al aceptar:** 200 grupos por cuenta, 50 cuentas por grupo y 200 miembros por grupo (solo al
  crear uno nuevo), antes de gastar el uso: una respuesta de error confirma la transacción y no puede
  dejar un uso gastado.
- **Token:** `gen_random_bytes(32)` (CSPRNG de pgcrypto), 43 caracteres base64url; comparación por
  hash con índice único.

### Fuera de alcance de este paso

El cliente (enlaces de entrada, almacenamiento del token pendiente, pantallas) se revisa con el bloque B
y en el paso 13. La concurrencia real de dos sesiones simultáneas no se puede reproducir en pgTAP ni en
PGlite (una sola conexión): la garantía descansa en el bloqueo del grupo, el `FOR UPDATE` y el
`UPDATE` condicionado, y se prueba como secuencia. Conviene probarla en el teléfono con dos cuentas.

## Bloque B: cliente (autoevaluación de la noche del 18 al 19)

Revisión manual del código nuevo del cliente (pasos 7 a 12), con las pruebas como evidencia. **No
reemplaza la revisión del paso 13** (skill security-code-review con `detect_changes`, después de los
builds): aquí queda lo que se miró y lo que se corrigió.

### Qué se revisó

`src/db/sync` (pull por páginas, `lost`, accesos, usuarios remotos), `src/features/invitations`,
`src/features/access`, `app/+native-intent.tsx`, `plugins/with-invite-links.js` y `web/links`.

### Hallazgos y estado

| Id | Sev. | Hallazgo | Estado |
|---|---|---|---|
| C4 | Media | Una fila con el `id` de otra fila local (de otro grupo, o un pagador o parte de otro gasto) se aplicaba por `id` y la secuestraba. | **Cerrado**: `findIdConflicts` no aplica la unidad y deja el grupo retenido (`pull-v2`, 2 pruebas). |
| C5 | Media | La respuesta de descarga no tenía tope en el cliente. | **Cerrado**: zod acota filas por grupo (2000), grupos (2000) y `lost` (1000); `createSyncRemote.pull` rechaza más filas que `p_max_rows`, grupos repetidos, `lost` fuera de lo pedido y una página parcial mezclada con otro grupo (`wire` y `remote`). |
| C7 | Media | Un servidor que nunca cerrara una descarga por páginas llenaba el teléfono con páginas guardadas. | **Corregido** con TDD: tope de 150 páginas por grupo (`MAX_STAGED_PAGES`); al pasarlo se descarta lo guardado y el grupo queda retenido. |
| C8 | Baja | Un grupo cuya creadora borró su cuenta llega con `created_by` nulo, y el esquema lo rechazaba: el grupo quedaba retenido para siempre. | **Corregido**: `created_by` nulo se guarda con un usuario remoto fijo (`DELETED_ACCOUNT_ID`); `compartir.int` lo prueba. |
| C9 | Baja | Si el servidor borra por cascada la fila de acceso de una cuenta ya marcada, el teléfono no se entera y la deja activa. | Aceptado: la fila solo sirve para las marcas «con cuenta» y «dueño»; el acceso real lo decide el servidor. |
| C10 | Info | El token se muestra solo en la hoja de compartir (por diseño) y se guarda en `invitation_links`, dentro de la base cifrada; se borra al revocar. No va a registros ni a mensajes de error (pruebas en `native-intent`, `pending-invite`, `invitation-service` y `InviteGroupScreen`). | Sin acción |
| C11 | Info | Cualquier app puede registrar el esquema `splitmate://`; por eso el enlace https verificado es el principal. Un enlace con el esquema propio solo entrega un token que el servidor valida. | Aceptado (diseño) |

### Verificado con pruebas

- `app/+native-intent.tsx` solo deja pasar `/auth/callback` validado y enlaces de invitación exactos
  (host configurado, ruta `/i`, sin consulta ni usuario ni puerto, token de 43 caracteres base64url en
  el fragmento); el token no viaja por la ruta.
- Toda respuesta del servidor de invitaciones pasa por zod; los errores del servidor se traducen a
  códigos y nunca copian su mensaje ni el token.
- `web/links`: sin recursos externos, sin código ni estilos en línea, CSP estricta,
  `Referrer-Policy: no-referrer`; la página solo usa `textContent` y valida el fragmento antes de
  armar el enlace.
- El plugin de Android agrega `https://<dominio>/i` con `autoVerify` y ruta exacta, solo si
  `EXPO_PUBLIC_INVITE_HOST` es un dominio; sin él, no toca nada.

### Para el paso 13

Revisar de nuevo con la skill y `detect_changes`, comprobar `adb shell pm get-app-links` en el teléfono
y confirmar en el panel que `log_parameter_max_length_on_error` sigue en 0 (I5).

## Segunda revisión (2026-10-18, jornada autónoma)

Revisión adversarial: se leyó el diff de la rama contra `main` como lo haría quien quiere entrar sin
invitación, quedarse después de una expulsión, sacar un token o agotar los topes. Servidor:
`20261018090000_acceso_membresia.sql`, `20261018100000_sync_pull_v2.sql`,
`20261019090000_invitaciones.sql` y los triggers de la 4a que siguen en pie (`check_member_link`,
`stamp_sync_row`). Cliente: `src/features/invitations`, `src/features/auth/AuthProvider.tsx`,
`app/+native-intent.tsx`, `src/lib/supabase/rpc.ts`, `src/db/repositories/invitation-links.ts`,
`plugins/with-invite-links.js` y `web/links`. No hay dependencias nuevas (`package.json` no cambió).
El grafo de código no estaba disponible (el servidor MCP no conectó); se leyó el código real.

**Resultado: sin hallazgos críticos ni altos. Un medio (C12) y dos bajos (C13, C14), corregidos con
pruebas escritas antes que el código. En el servidor no salió nada de severidad media o superior, así
que `20261019090000_invitaciones.sql` no cambió.**

### Hallazgos corregidos

| Id | Sev. | Hallazgo | Estado |
|---|---|---|---|
| C12 | Media | El enlace de invitación pendiente (en memoria y en `expo-secure-store`) no se borraba al cerrar sesión ni al pasar a otra cuenta. En un teléfono compartido, quien entraba después veía la vista previa del grupo de la persona anterior (nombre, miembros sin cuenta) y podía unirse con su enlace. | **Corregido**: `AuthProvider` llama a `clearPendingInvite()` cuando una sesión con usuario termina (cierre propio, cierre de Supabase, borrar cuenta) o cambia de usuario. Entrar desde «sin sesión» lo conserva, porque es el caso de quien se registra con un enlace. Al abrir la app se borra también el que ya venció (`purgeExpiredPendingInvite`), aunque no haya sesión. Pruebas: 6 en `AuthProvider.test.tsx` y 1 en `pending-invite.test.ts`. |
| C13 | Baja | El token de un enlace que ya no sirve (vencido, revocado desde otro teléfono o por una expulsión, agotado, o que el servidor dejó de listar a los 7 días) quedaba para siempre en `invitation_links`, dentro de la base cifrada. | **Corregido**: al cargar la lista, `InviteGroupScreen` borra los tokens locales cuyo estado no es `active` o que el servidor ya no lista; uno creado después de pedir la lista no se toca (carrera con «crear»). Prueba nueva en `InviteGroupScreen.test.tsx`. |
| C14 | Baja | El aviso de «Quitar acceso» decía que los enlaces vigentes dejan de servir, pero no que el dueño tendrá que crear otros. | **Corregido**: el texto (es/en) ahora lo dice; prueba en `GroupSettingsScreen.access.test.tsx`. |

### Preguntas del encargo, con su respuesta

**Funciones `SECURITY DEFINER`.** Las cinco RPC y las de apoyo tienen `set search_path = ''`; cada
objeto va calificado (`private.`, `public.`, `extensions.gen_random_bytes`) y lo demás es de
`pg_catalog`. `revoke ... from public, anon, authenticated, service_role` y `grant execute` solo a
`authenticated` en las cinco; las de apoyo (`claim_invitation_use`, `invitation_attempts_blocked`,
`invitation_failure`, `release_access`) no las ejecuta nadie más que las RPC.

- **Quién crea, revoca y lista.** Crear y listar piden `can_access_group` (acceso activo en
  `group_access`; ser creador ya no basta). Revocar pide acceso activo y ser quien creó el enlace o el
  dueño. Un id que no existe, de otro grupo o sin permiso da el mismo `42501`.
- **IDOR entre grupos.** Ninguna RPC acepta un `group_id` junto con un `invitation_id`: la revocación
  deduce el grupo de la propia invitación y comprueba el acceso a ese grupo; `list_invitations` filtra
  por el grupo al que se tiene acceso; en `accept_invitation` el miembro elegido debe pertenecer al
  grupo de la invitación (`m.group_id = v_group_id`), si no es `SMTKN`.
- **`list_invitations` nunca expone el hash ni el token**: el `select` interior no los nombra y la
  prueba de `013` comprueba las claves exactas (`id, created_by, created_at, expires_at, max_uses,
  use_count, revoked_at, status`).

**`accept_invitation`.**

- *Misma persona dos veces:* la segunda llamada ve `can_access_group` y devuelve `{ group_id }` sin
  reclamar un uso, sin escribir historial y sin tocar el miembro (prueba de `013`, «Aceptar otra vez
  devuelve lo mismo»). Dos llamadas simultáneas de la misma cuenta se serializan en el bloqueo del
  contador del grupo, así que la segunda siempre cae en ese camino y no hay violación de la clave
  única `(group_id, user_id)`. Con dos enlaces distintos pasa lo mismo.
- *Grupo lleno:* 50 cuentas activas, 200 miembros y 200 grupos por cuenta se revisan **antes** de
  reclamar el uso y responden `SMGFL`; como la respuesta confirma la transacción, no puede quedar un
  uso gastado.
- *Ya es miembro:* ver arriba. *Expulsado:* puede volver, pero solo con un enlace creado después de la
  expulsión, porque `remove_access` revoca todos los vigentes (I1); su fila de acceso se reactiva como
  `member`, nunca como `owner`. *Salió por su cuenta:* igual, y sus propios enlaces quedaron revocados.
- *Revocado a mitad:* quien acepta bloquea primero el contador del grupo y luego la invitación
  (`FOR UPDATE`); revocar y expulsar toman el mismo bloqueo del grupo antes de escribir. O la
  revocación confirmó antes (y la aceptación ve el enlace revocado y da `SMINV`) o la aceptación
  confirmó antes (y fue legítima). No hay orden intermedio ni interbloqueo, porque todas toman el
  contador del grupo antes que la invitación.
- *Cuenta recién creada:* los topes son por cuenta (I4): 10 intentos fallidos por hora, 20 enlaces por
  día y 20 activos por grupo. Una cuenta nueva no se salta ninguno, pero quien tenga muchas cuentas
  multiplica los intentos; con 256 bits de token eso no sirve para adivinar, y el alta de cuentas está
  limitada por Auth. Queda como I4 (aceptado) y el CAPTCHA, en pendientes.

**Expulsar o quitar acceso revoca los enlaces y la interfaz lo avisa:** `remove_access` revoca todos los
vigentes del grupo si el destinatario tenía acceso; `leave_group`, los del que sale. El aviso del dueño
decía solo la mitad (C14, corregido).

**`sync_pull_v2` y `group_access`.** La función es `SECURITY INVOKER`: todo pasa por RLS. Las políticas
de `groups`, `group_access`, `group_members`, etc. piden `can_access_group`, que lee `group_access` con
`deleted_at is null`. Un usuario sin acceso no recibe filas nuevas de ese grupo, ni siquiera con un
cursor viejo: el grupo no está en `visible`, y sale en `lost`. `lost` solo dice «este id no lo ves»,
igual para un grupo que no existe que para uno que perdiste. La única excepción de lectura es el
creador de un grupo recién insertado sin ninguna fila de acceso (`group_has_access_rows`), que no se
puede explotar: el trigger del dueño agrega su fila en la misma instrucción, y un creador expulsado
tiene su fila con `deleted_at`, que cuenta como «hay filas».

**Solo lectura no escribe por `sync_push`.** `sync_push` es `SECURITY INVOKER`, así que las políticas
de inserción y actualización exigen `can_access_group` y fallan con `forbidden`. Volver a insertar un
grupo perdido choca con la clave primaria (`forbidden`, no se crea otro) y editarlo da `not_found`.
`group_access` no tiene `INSERT`, `UPDATE` ni `DELETE` para `authenticated`. Un miembro no puede
poner la cuenta de otra persona en un miembro (`check_member_link`, que solo se salta con roles de
servidor, como las RPC `SECURITY DEFINER`).

**Cliente.**

- *El token fuera de registros y reportes:* `logger` no registra nada en producción y, en
  desarrollo, los únicos mensajes de este código son fijos y sin argumentos. `createSupabaseRpc` copia
  solo el código del error, nunca el mensaje ni los argumentos. No hay servicio de reporte de errores
  (ni Sentry ni equivalente) ni captura global de excepciones; si se agrega uno, hay que excluir los
  argumentos de las RPC de invitaciones.
- *En la ruta, el historial de navegación y los parámetros:* `redirectSystemPath` devuelve solo
  `/invite`; el token queda en el fragmento del enlace de entrada, nunca en la ruta del router ni en
  `useLocalSearchParams`. Pruebas en `native-intent.test.ts`.
- *En el portapapeles:* la app no lo escribe nunca (no usa `expo-clipboard`); comparte con la hoja
  del sistema (`Share.share`). Lo que la persona elija ahí, como «Copiar», es decisión suya. La página
  web de respaldo copia el enlace solo al pulsar «Copiar enlace».
- *En almacenamiento sin cifrar:* el pendiente va a `expo-secure-store`; el de «Compartir de nuevo», a
  `invitation_links` dentro de SQLCipher; ninguno entra al respaldo de Android (excluido) ni se
  sincroniza.
- *Enlaces malformados, enormes o con esquemas raros:* `parseInviteLink` limita a 256 caracteres
  (2048 si es un mensaje pegado), exige el host exacto (sin usuario, puerto, consulta ni ruta extra) o
  `splitmate://`, y el token de 43 caracteres base64url. `javascript:`, `intent:`, `http:`, `file:`,
  hosts parecidos y fragmentos con porcentajes se rechazan; `INVITE_HOST` con el marcador `<dominio>`
  nunca coincide con nada.
- *Pendiente de 1 hora:* vence en memoria y en el almacén; se borra al usarlo, ante un error que no
  mejora, al abrir la app si ya venció (C12), al cerrar sesión y al cambiar de cuenta (C12).
- *Android:* el `intent-filter` es solo `https://<dominio>/i` con ruta exacta y `autoVerify`.

### Descartado, con su motivo

| Id | Sev. | Qué se consideró | Por qué no se cambia |
|---|---|---|---|
| I8 | Info | `group_access.invitation_id` baja a todos los miembros del grupo, y `list_invitations` muestra `created_by`: cualquier miembro puede saber quién invitó a quién. | Es información del propio grupo, ya visible por la lista de cuentas; el id de la invitación no sirve para nada sin el token. |
| I9 | Info | Los intentos con un token que existe pero está vencido o revocado toman el bloqueo del grupo antes de fallar, así que tardan algo más que los de un token inexistente. | Es un canal lateral de tiempo sobre un valor de 256 bits que ya hay que conocer entero. No hay nada que adivinar. |
| I10 | Baja | `accept_invitation` lanza `22023` si el id del miembro nuevo ya existe, y ese error lleva el cuerpo de la petición. | Solo lo provoca un cliente defectuoso o el dueño del propio token (I5). Se revisará al ver `log_parameter_max_length_on_error` (tarea 3). |
| C15 | Info | Otra app instalada puede abrir `splitmate://i#<token>` con un token suyo y mostrar la vista previa de su grupo (suplantación). | Aceptar exige una pulsación explícita y la vista previa muestra el nombre del grupo; el servidor valida el token. Es el mismo supuesto que C11. El enlace https verificado es el principal. |
| C16 | Baja | El teclado puede aprender o sugerir el texto pegado en «Unirme con un enlace». | No hay forma portable de impedirlo salvo `secureTextEntry`, que oculta el texto y estorba. El campo ya usa `autoComplete="off"` y `autoCorrect={false}`. |
| C17 | Info | Un enlace pendiente viaja de una cuenta a otra si llega **antes** de iniciar sesión. | Es el flujo previsto (registrarse con un enlace); se limita a 1 hora y se borra al cerrar sesión. |
| I11 | Info | `rate_events` crece sin límite si una cuenta deja de usar la app. | Ya es I3; cada cuenta tiene como máximo 10 + 20 filas vivas por día. |
| I12 | Info | Orden de bloqueos con `sync_push` y `leave_group`. | Todas toman primero el contador del grupo; no hay ciclo posible. |

### Pendiente para la prueba real

La concurrencia del último uso se prueba en el CI con dos conexiones (tarea 2 de la jornada). La
verificación de `log_parameter_max_length_on_error` en el remoto es la tarea 3.
