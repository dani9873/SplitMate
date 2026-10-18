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
