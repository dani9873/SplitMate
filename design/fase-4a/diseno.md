# Fase 4a — Diseño: sincronización con Supabase

Propuesta del 2026-10-14, pendiente de aprobación. El avance paso a paso está en `progreso.md` y
las tareas en `plan.md`.

## Objetivo

Que los datos de cada cuenta vivan en Supabase y se sincronicen entre sus dispositivos, sin perder
el funcionamiento offline-first. La base local sigue siendo la fuente de verdad de la UI: la app
lee y escribe siempre en SQLite, y la sincronización sube y baja cambios por detrás.

En la Fase 4a cada grupo tiene una sola cuenta (todavía no hay invitaciones). Sincronizar es, por
ahora, mantener iguales tus dispositivos y la copia en la nube. El protocolo ya sirve para grupos
compartidos: el acceso lo decide RLS, el cursor es por grupo y los conflictos se resuelven igual
entre dos personas que entre dos teléfonos.

**Fuera de alcance (Fase 4b):** invitaciones por enlace, unirse a grupos, perfiles de otras
cuentas y lo que cambia al borrar una cuenta que comparte grupos.

## Paso previo

- **Parches de Expo** que marca expo-doctor, con `npx expo install --fix`: expo 57.0.28,
  expo-crypto 57.0.4, expo-dev-client 57.0.20, expo-router 57.0.26, expo-splash-screen 57.0.10 y
  jest-expo 57.0.6. Tres traen código nativo y entran en los builds del cierre.
- **Perfil `preview` en `eas.json`:** APK de distribución interna con `environment: preview`. Las
  credenciales son las de EAS (`credentialsSource: remote`, el valor por omisión): EAS genera el
  keystore en el primer build y lo guarda. Las variables `EXPO_PUBLIC_SUPABASE_URL` y
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` se crean en el entorno `preview` de EAS, como sensibles y
  copiadas de `.env` sin mostrarlas: el APK de preview lleva el JS adentro y no usa Metro.
- **Sin builds** hasta el cierre de la fase; ahí se lanzan juntos el development y el preview.
- El APK de preview y el development build tienen el mismo paquete con firmas distintas: Android
  no instala uno encima del otro. Para pasar de uno a otro hay que desinstalar el anterior. Con la
  sincronización, al volver a entrar los datos se descargan de nuevo, y eso también se prueba.

## Decisiones

| Tema               | Decisión                                                                                                                                                             | Alternativas descartadas                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cola de envío      | Pendiente = fila con `version` distinta de `synced_version`. `sync_outbox` guarda cada envío en curso: su id y su contenido exacto                                   | Tabla outbox escrita por cada repositorio: una escritura nueva puede olvidarla. Triggers de SQLite: necesitan una bandera para ignorar lo que escribe la sincronización |
| Cursor de descarga | Contador por grupo en el servidor (`change_seq`), asignado bajo el candado del contador del grupo                                                                    | Secuencia global: un commit tardío deja huecos y exige una ventana con `xmin`. `updated_at`: depende de relojes                                                         |
| Escrituras         | RPC `sync_push` con `SECURITY INVOKER`: RLS y los privilegios por columna aplican adentro. Un trigger rechaza las escrituras directas                                | `SECURITY DEFINER` con chequeos propios: se salta RLS y un olvido es una fuga. Un rol propio dueño de la RPC: más piezas que mantener en Supabase                       |
| Conflictos         | `version` por fila; gana el último cambio en llegar al servidor; reglas para los estados (borrar, archivar, moneda, "soy yo"); el gasto con sus partes es una unidad | Por campo: exige guardar la versión base de cada campo. El primero gana y el cliente rehace: interrumpe al usuario                                                      |
| Descarga           | Estado actual de lo que cambió desde el cursor, por grupo completo, aplicado en una transacción                                                                      | Registro de eventos: crece sin límite y repite trabajo                                                                                                                  |
| Acceso a un grupo  | Su creador o un miembro vinculado activo                                                                                                                             | Solo miembros vinculados: un grupo sin "yo" ("Ninguno de ellos", permitido desde la Fase 2) no se podría subir                                                          |
| Realtime           | Después, en la Fase 4b (sección "Realtime")                                                                                                                          | Ahora: con una cuenta por grupo aporta poco                                                                                                                             |
| Detección de red   | `expo-network` (módulo del SDK)                                                                                                                                      | `@react-native-community/netinfo`: hace lo mismo y no es del SDK                                                                                                        |
| Pruebas del motor  | Contra el SQL real: PGlite 0.5.8 (Postgres en WASM) dentro de Jest                                                                                                   | Un servidor falso en TypeScript: dos implementaciones de las reglas que pueden divergir                                                                                 |

## Cómo funciona, de punta a punta

```
Escribir (repositorio) ─► fila pendiente (version ≠ synced_version)
        │                     │ espera de 2 s para agrupar
        ▼                     ▼
  bus 'local'  ─────────► ciclo de sincronización (uno a la vez)
                              1. perfil remoto asegurado
                              2. envío por lotes ──► sync_push ──► respuesta con el estado final
                              3. descarga por grupo ◄── sync_pull(cursores)
                              4. bus 'sync' ──► las pantallas vuelven a leer (useLiveQuery)
```

## Servidor

### Columnas que pone el servidor

Un trigger `BEFORE INSERT OR UPDATE` en las siete tablas de grupo (`groups`, `group_members`,
`categories`, `expenses`, `expense_payers`, `expense_splits`, `transfers`) fija lo que el cliente
no decide:

- `created_at`: `now()` al insertar; al editar, conserva el anterior.
- `updated_at`: `now()` siempre (la hora del servidor, no la del teléfono).
- `version`: 1 al insertar; la anterior más 1 al editar.
- `deleted_at` y, en `groups`, `archived_at`: si llegan con valor, el servidor pone `now()`, o
  conserva el instante anterior si la fila ya estaba borrada o archivada. Para el cliente son "sí o
  no".
- `change_seq`: la posición del cambio en la secuencia de su grupo (siguiente sección).

Este trigger también corre en las escrituras que no vienen de la app, por ejemplo el `SET NULL` de
borrar una cuenta: así esos cambios también tienen `change_seq` y llegan a los demás dispositivos.
Era un pendiente anotado en el diseño de la Fase 3.

### Secuencia de cambios por grupo

- `private.group_changes (group_id, last_seq)`: un contador por grupo.
  `private.next_change_seq(group_id)` lo incrementa y devuelve el valor nuevo.
- Cada fila escrita recibe `change_seq`. La fila de `groups` usa su propio `id`; las predefinidas de
  `categories`, sin grupo, quedan en 0 y no se descargan.
- **Sin huecos.** El contador queda bloqueado desde la primera escritura de una transacción hasta su
  commit, así que dos transacciones del mismo grupo no se intercalan. Si una lectura ve el valor N,
  ya ve todo lo anterior a N. Con una secuencia global eso no pasa: una transacción puede tomar el
  número 100, otra el 101, la segunda confirma primero, alguien lee 101 y el 100 aparece después,
  detrás del cursor.
- **Un grupo nuevo para el cliente empieza en 0.** En la Fase 4b, al unirse a un grupo, se descarga
  completo sin nada especial.
- Índice `(group_id, change_seq)` en cada tabla.

### Solo `sync_push` escribe

- `authenticated` conserva `SELECT`, `INSERT` y `UPDATE` por columna, porque `sync_push` corre con
  sus permisos (`SECURITY INVOKER`): RLS y los privilegios por columna también protegen lo que hace
  la RPC.
- `sync_push` marca su transacción con `set_config('splitmate.sync_push', 'on', true)`. El trigger
  rechaza con `42501` cualquier escritura de `authenticated` (o `anon`) sin esa marca: un `POST` o
  `PATCH` directo por REST o por GraphQL ya no llega a las tablas. Un cliente no puede poner esa
  marca: PostgREST no expone `set_config` y la marca dura solo la transacción.
- `postgres`, las migraciones y las cascadas de borrar una cuenta no pasan por la guardia.
- `profiles` queda como en la Fase 3: la app asegura su perfil con un upsert directo. No es una
  tabla de grupo y en esta fase no se sincroniza.

### Acceso (RLS)

- `private.can_access_group(group_id)`: eres el creador del grupo (`created_by`) o un miembro
  vinculado activo. Reemplaza a `is_group_member` en las políticas de las tablas de grupo.
- En `groups`, la política compara su propio `created_by` en lugar de buscar el grupo, porque en un
  `INSERT ... ON CONFLICT` o con `RETURNING` la fila nueva todavía no es visible para una consulta.
- `group_members`: se inserta un miembro con `user_id` nulo o el tuyo, nunca el de otra cuenta. El
  rol `owner` solo lo inserta el creador del grupo.
- Sale `private.can_bootstrap_group`: con el acceso del creador ya no hace falta el orden "grupo,
  luego primer miembro" que exigía la Fase 3.
- **Por qué el creador:** desde la Fase 2 un grupo puede no tener "yo" (la opción "Ninguno de
  ellos"). Con acceso solo para miembros vinculados, ese grupo no se podría subir ni leer. En la
  Fase 4b, quien se une entra como miembro vinculado; qué pasa si el creador sale del grupo se
  decide allí.

### Reglas en la base

Triggers que valen para cualquier escritura, no solo para la RPC:

| Regla                                                                                       | Error                              |
| ------------------------------------------------------------------------------------------- | ---------------------------------- |
| La moneda de un grupo no cambia si tiene movimientos activos                                | `SMCUR` → `currency_locked`        |
| Un gasto o transferencia activo tiene `group_currency` igual a la moneda actual de su grupo | `SMGCC` → `group_currency_changed` |
| `authenticated` solo vincula o desvincula su propia cuenta en `group_members.user_id`       | `42501`                            |
| La categoría de un gasto es predefinida o del grupo (de la Fase 3)                          | `23503`                            |

`group_currency` es una columna nueva de `expenses` y `transfers`: la moneda del grupo en la que
está `group_amount`. La app la guarda al calcular. Sin ella, un gasto calculado en USD en un
teléfono sin conexión podría subir después de que otro teléfono cambiara la moneda del grupo a
EUR, y quedaría con montos en la moneda equivocada.

### `sync_push(p_mutations jsonb) → jsonb`

`SECURITY INVOKER`, `set search_path = ''`, solo para `authenticated`. Recibe hasta 50 envíos:

```json
{ "id": "<uuid del envío>", "entity": "expense", "base": 3, "data": { "...": "..." } }
```

- `base`: la versión del servidor sobre la que se hizo el cambio; `null` si la fila es nueva.
- `data` por unidad:
  - `group`: `id`, `name`, `currency`, `emoji`, `color`, `archived`, `deleted`.
  - `member`: `id`, `group_id`, `display_name`, `user_id`, `role`, `deleted`.
  - `category` (personalizada): `id`, `group_id`, `name`, `icon`, `deleted`.
  - `expense`: los campos del gasto, `group_currency`, `deleted`, y sus pagadores y partes activos
    (`payers` y `splits`, con `id`, `member_id`, `amount`, `group_amount` e `input_value`).
  - `transfer`: los campos de la transferencia, `group_currency` y `deleted`.
- El servidor nunca toma del cliente `created_by` (es siempre `auth.uid()`), las fechas de
  auditoría, `version` ni `change_seq`.

Responde una lista en el mismo orden:

```json
{ "id": "...", "status": "applied", "version": 4, "current": [{ "table": "expenses", "row": {} }] }
{ "id": "...", "status": "rejected", "reason": "deleted", "current": [] }
{ "id": "...", "status": "failed", "reason": "invalid" }
```

- `applied`: se aplicó, o ya se había aplicado (reenvío). `current` trae el estado final en el
  servidor: la fila, o el gasto con todos sus pagadores y partes.
- `rejected`: un conflicto esperado (tabla de conflictos). `current` trae el estado del servidor,
  vacío si la unidad no existe allí. El cliente vuelve a ese estado y avisa.
- `failed`: algo que no debería pasar con una app correcta: `forbidden` (RLS), `invalid` (datos o
  sumas), `not_found` (la unidad tenía versión y ya no existe) o `error`. El cliente conserva sus
  datos y aparta el envío.

**Cómo procesa:**

1. Valida la forma: arreglo de hasta 50 envíos (vacío devuelve `[]`), unidades conocidas, ids UUID.
   Si falla, error 400 de toda la llamada (es un error de programación).
2. Recorre los envíos por grupo. Antes de tocar un grupo bloquea su contador, y por eso dos envíos
   al mismo grupo esperan en vez de cruzarse (sin interbloqueos entre filas). La app ya los manda
   ordenados por grupo; la RPC procesa en el orden recibido.
3. Por envío: candado `pg_advisory_xact_lock` sobre su id; si ya figura en `private.sync_mutations`
   como aplicado, responde `applied` con la versión guardada y el estado actual, sin volver a
   aplicarlo.
4. Aplica la unidad dentro de un bloque `BEGIN ... EXCEPTION` (un punto de guardado): si falla, se
   deshace solo ese envío y la RPC sigue con los demás. Los interbloqueos (`40P01`) y los errores
   de serialización se relanzan: la llamada entera falla y el cliente la repite.
5. Registra el envío aplicado en `private.sync_mutations` (cuenta, id, unidad, versión).

Con 50 envíos por llamada, la RPC queda por debajo de las 64 subtransacciones que Postgres guarda
en memoria por sesión.

**Validación por unidad** (además de los CHECK, las FKs y las reglas):

- Un gasto activo tiene de 1 a 50 pagadores y de 1 a 50 partes, sin miembros repetidos. Los
  pagadores suman `amount` y `group_amount`, y las partes también. Si `currency` es la del grupo,
  la tasa es `1` y `group_amount = amount` en el gasto y en cada parte.
- Las partes no se editan: una parte que ya existe solo cambia `deleted_at`. Una edición crea partes
  nuevas, como en la base local.
- `group_id` de una fila existente no cambia.
- Un cambio idéntico al estado del servidor no escribe nada: devuelve `applied` con la versión
  actual. Así no se generan versiones ni descargas de más.

**Gasto como unidad.** El servidor bloquea el gasto (`FOR UPDATE`) y decide el conflicto con su
`version`. Si aplica: marca borradas las partes activas que no vienen, después crea o reactiva las
que vienen (primero liberar, para no chocar con el índice único de miembro por gasto) y toca el
gasto para que su `version` suba con cualquier cambio de sus partes. Un gasto borrado viene sin
partes y el servidor borra las activas. Nunca quedan pagadores de un cambio con partes de otro.

### Conflictos

Hay conflicto cuando `base` no es la `version` actual del servidor: alguien cambió la fila después
de lo último que vio este dispositivo. Gana el último cambio en llegar al servidor, con estas reglas
para los campos de estado:

| Campo                           | Con la versión al día                                                  | Con una versión vieja               |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------- |
| Borrar                          | Se aplica                                                              | Se aplica: borrar gana              |
| Editar o restaurar algo borrado | Se aplica                                                              | `rejected: deleted`: sigue borrado  |
| Archivar                        | Se aplica                                                              | Se aplica: archivar gana            |
| Desarchivar                     | Se aplica                                                              | Se ignora: sigue archivado          |
| Moneda del grupo                | Se aplica si no hay movimientos; si hay, `rejected: currency_locked`   | Se ignora: queda la del servidor    |
| "Soy yo" (`user_id`)            | Se aplica y mueve tu vínculo: el miembro que lo tenía queda sin cuenta | Se ignora: queda el del servidor    |
| Resto de los campos             | Se aplica                                                              | Se aplica: gana el último en llegar |
| Gasto con pagadores y partes    | Se aplica como unidad                                                  | Se aplica como unidad               |

Además, un movimiento calculado con otra moneda de grupo se rechaza con `group_currency_changed`,
tenga o no la versión al día.

**Por qué así.** Con una versión vieja, el envío trae los valores de estado que tenía el teléfono,
no necesariamente los que el usuario quiso cambiar. Si ganaran siempre, renombrar un grupo en un
teléfono atrasado lo desarchivaría, devolvería una moneda vieja o movería "soy yo". Borrar y
archivar ganan porque son acciones explícitas, y lo que deshacen se puede volver a hacer con la
versión al día. No se fusiona campo por campo: con una cuenta por grupo los choques son raros y la
regla por fila se explica en una línea. Si en la Fase 4b resultan frecuentes, se revisa.

**Grupo archivado o borrado.** El servidor no rechaza un gasto nuevo en un grupo que otro
dispositivo archivó o borró: el gasto se guarda y el grupo sigue archivado o borrado. El grupo
archivado es de solo lectura en la app, pero no es una barrera de seguridad (cualquier miembro lo
desarchiva), y rechazar haría perder lo que el usuario escribió sin conexión. Era una de las
"revisiones pendientes para la Fase 4" del diseño de la Fase 3; queda resuelta con esta regla.

**Quitar miembros.** Las reglas "sin saldo" y "no el último" las sigue revisando la app. Si dos
dispositivos chocan (por ejemplo, uno quita a Beto y otro registra un gasto con él), el servidor
guarda ambos y Beto aparece en Saldos con la nota "ya no está en el grupo", un estado que la app ya
muestra desde la Fase 2.

### Idempotencia

- Cada envío tiene un id (UUID) que se genera una vez y se guarda en el teléfono con el contenido
  exacto. Si no llega la respuesta, el teléfono repite **el mismo envío**.
- El servidor guarda los envíos aplicados en `private.sync_mutations (user_id, mutation_id, entity,
entity_id, version, applied_at)`, con clave `(user_id, mutation_id)`. Un envío repetido devuelve
  el resultado guardado y no vuelve a aplicar nada: sin filas ni versiones de más, y sin pisar
  cambios que otros hicieron después.
- Los ids de las filas son UUID v7 generados en el cliente: repetir un alta nunca duplica una fila.
- El candado por id de envío cubre el caso de dos llamadas con el mismo envío a la vez (una que se
  dio por perdida y su reintento).
- Los envíos rechazados no se guardan: si se repiten, se vuelven a evaluar sin efectos.
- Las funciones que leen y escriben `private.sync_mutations` son `SECURITY DEFINER` y solo tocan las
  filas de `auth.uid()`. Se borran en cascada con la cuenta. No se purgan en esta fase (son unos 100
  bytes por cambio).

### `sync_pull(p_cursors jsonb, p_max_rows integer default 2000) → jsonb`

`SECURITY INVOKER` y `STABLE`: todas sus consultas ven la misma foto de la base, así que no puede
devolver un gasto sin el miembro que creó la transacción siguiente.

- `p_cursors`: `{ "<id de grupo>": <change_seq>, ... }`, hasta 1000 grupos. Un grupo que no viene
  empieza en 0.
- Devuelve los grupos visibles por RLS (los tuyos, borrados incluidos) que tengan cambios, cada uno
  **completo**, ordenados por id. Junta grupos hasta `p_max_rows` filas (entre 100 y 5000) y siempre
  devuelve al menos uno aunque lo supere:

```json
{
  "groups": [{ "id": "<uuid>", "cursor": 57, "rows": [{ "table": "group_members", "row": {} }] }],
  "has_more": false
}
```

- Cada fila va con todas sus columnas, también las borradas lógicamente.
- `cursor` es el `change_seq` más alto del grupo en esa foto.
- Por qué grupos completos: la descarga es el estado actual, no un registro. Una fila cambiada otra
  vez después queda con su `change_seq` nuevo, y cortar un grupo por la mitad podría traer un hijo
  antes que su padre. Las reglas de unicidad y las FKs son todas dentro de un grupo, así que un grupo
  completo siempre se puede aplicar.
- Supabase limita las respuestas de tablas a `max_rows`, pero una función que devuelve un solo
  `jsonb` no se corta.

### Privilegios

| Rol             | Cambio                                                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticated` | Pierde `UPDATE` de `updated_at` y `version` (las pone el servidor). Gana `UPDATE` de `group_members.user_id` y de `group_currency`. En pagadores y partes, solo `deleted_at`. `EXECUTE` en `sync_push` y `sync_pull` |
| `authenticated` | `EXECUTE` en las funciones de `private` que llaman las políticas, los triggers y la RPC. `private` sigue fuera de la Data API                                                                                        |
| `anon`          | Nada, como hasta ahora                                                                                                                                                                                               |
| `service_role`  | Ningún privilegio en las tablas de `public`: igual que el remoto desde el cambio del panel (pendiente de CLAUDE.md). `delete-account` solo usa `auth.admin`                                                          |
| Por omisión     | `postgres` en `public` no da nada a `anon`, `authenticated` ni `service_role`, ni `EXECUTE` a `PUBLIC` en funciones nuevas: el repo queda igual que el remoto                                                        |

Cada función nueva lleva en su migración `revoke all ... from public, anon` y el `grant` exacto.
`006-privilegios.test.sql` se actualiza con la matriz nueva y `npm run check:data-api` suma:

- `anon` no ejecuta `sync_push` ni `sync_pull` (401 `42501`);
- `authenticated` ejecuta `sync_pull` (200, sin grupos para `prueba1`) y `sync_push` con una lista
  vacía (200, `[]`);
- un `POST` directo a `groups` con un nombre vacío responde `42501` de la guardia. Si la guardia
  faltara, respondería `23514` (CHECK) y tampoco escribiría nada.

### Borrar la cuenta

Un trigger `BEFORE DELETE` en `profiles` (corre en la cascada de `auth.admin.deleteUser`) borra los
grupos que nadie más podría abrir: los creados por la cuenta o con su miembro, sin otro miembro
vinculado activo. En la Fase 4a son todos los grupos de la cuenta, y sus filas caen en cascada.
Sin esto, borrar la cuenta dejaría sus gastos huérfanos en la nube. Es lo que ya promete la
pantalla de borrar la cuenta. Lo que pasa con los grupos compartidos sigue en la Fase 4b.

### Migraciones

Tres archivos en `supabase/migrations`, aplicados juntos con un `db push` en el punto de control:

1. `<fecha>_sincronizacion_base.sql`: `change_seq`, `group_changes`, `group_currency`, los
   triggers, la guardia, RLS con el acceso del creador y los privilegios.
2. `<fecha>_sincronizacion_rpc.sql`: `sync_mutations`, `sync_push`, `sync_pull` y sus funciones de
   apoyo.
3. `<fecha>_borrar_cuenta_grupos.sql`: el trigger de `profiles`.

El remoto no tiene grupos (0 grupos y 2 perfiles el 2026-10-14), así que los rellenos no tocan datos
reales.

## Cliente

### Base local (migración 0004)

En las siete tablas sincronizables:

- `server_version`: la versión del servidor que conoce la fila; nula si nunca subió. Es la `base` de
  cada envío.
- `synced_version`: el `version` local que coincide con el servidor. La fila está **pendiente** si
  `synced_version` es nula o distinta de `version`.

El `version` local sigue siendo el contador de la app: lo sube cada escritura y lo usan los
formularios para el bloqueo optimista. La sincronización solo lo sube cuando cambia el contenido de
una fila con datos que llegan del servidor.

También:

- `group_currency` en `expenses` y `transfers`, rellenado con la moneda actual de su grupo. Para
  todo movimiento activo es la que se usó, porque la moneda no cambia mientras haya movimientos.
- `sync_outbox (entity, entity_id, mutation_id, sent_version, payload, state, reason, attempts,
updated_at)`: un envío en curso (`sent`) o apartado (`failed`) por unidad.
- `sync_cursors (group_id, seq, updated_at)`.
- Índices parciales de filas pendientes, para contarlas y recorrerlas sin leer toda la tabla.
- Las 9 categorías predefinidas quedan sincronizadas (existen iguales en el servidor). Todo lo demás
  queda pendiente: **la primera sincronización sube todo lo creado en las Fases 1 a 3**, incluidos
  los grupos sin "yo" y los miembros quitados que siguen en movimientos viejos.

Los repositorios guardan `group_currency` al registrar o editar un movimiento. Restaurar un
movimiento borrado cuya moneda de grupo ya no es la actual se rechaza (`CURRENCY_CHANGED`): hoy la
app lo permitiría y dejaría montos en otra moneda.

### Unidades de sincronización

- **Una fila:** grupo, miembro, categoría personalizada (todavía sin pantalla) y transferencia.
- **Un gasto o ingreso** con sus pagadores y partes activos. Toda escritura de partes sube la
  `version` del gasto, así que la unidad está pendiente si el gasto lo está.

### Envío

1. Toma hasta 50 unidades pendientes y no apartadas, ordenadas por grupo y, dentro del grupo, por
   dependencias: grupo, miembros, categorías, gastos y transferencias.
2. Antes de enviarlas las guarda en `sync_outbox` con un id nuevo y el contenido exacto. Si una
   unidad ya tenía un envío sin respuesta, repite ese mismo.
3. Con la respuesta:
   - `applied`: si la unidad no cambió mientras viajaba, aplica `current` y queda al día. Si cambió,
     solo guarda `server_version` y sigue pendiente: el próximo lote lleva lo nuevo con la base
     correcta.
   - `rejected`: aplica `current` (si viene vacío, la unidad nunca existió en el servidor y se borra
     del teléfono) y emite un aviso.
   - `failed`: deja el envío apartado y los datos como están. El estado pasa a "error". Se reintenta
     al abrir la app de nuevo o con "Reintentar".
4. Sin red, con un error del servidor o sin respuesta, el envío queda en `sync_outbox` y se repite
   igual en el próximo intento.

### Aplicar datos del servidor

Vale para la descarga y para el `current` de cada respuesta:

- Un grupo por transacción local, con `PRAGMA defer_foreign_keys = ON` (las FKs se revisan al
  confirmar).
- En la descarga se saltan las filas de unidades pendientes: el envío decide y su respuesta trae el
  estado final.
- Orden: por tabla (padres antes que hijos) y, dentro de cada tabla, primero lo que libera (filas
  borradas, miembros sin cuenta) y después lo que ocupa. Así no chocan los índices únicos de "un yo
  por grupo" y "un pagador o una parte por miembro".
- Cada fila en su punto de guardado. Si el contenido es igual al local, solo actualiza
  `server_version` y las fechas del servidor, sin subir `version` (el eco de lo que el teléfono
  mismo subió no molesta a un formulario abierto). Si es distinto, la reemplaza y sube `version`.
- Si una fila falla por una restricción, el cursor del grupo no avanza y se reintenta en el próximo
  ciclo. Si falla sin unidades pendientes en ese grupo, es una inconsistencia: estado "error".
- Al aplicar el gasto completo de un `current`, se borran del teléfono las partes de ese gasto que
  el servidor no tiene: las de un cambio rechazado o restos locales ya borrados.
- Al terminar, un solo aviso en el bus con `source: 'sync'` y el grupo: las pantallas vuelven a leer
  con `useLiveQuery`.

### Cuándo sincroniza

| Momento                      | Cómo                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Al abrir la app (base lista) | De inmediato                                                                    |
| Al volver al primer plano    | `AppState` activo, de inmediato                                                 |
| Al reconectar                | `expo-network`, de inmediato                                                    |
| Tras cada escritura          | Aviso del bus con `source: 'local'`; espera 2 s sin escrituras, como mucho 10 s |
| "Sincronizar ahora"          | De inmediato                                                                    |

- Un ciclo a la vez. Lo que se pide durante un ciclo produce un ciclo más al terminar.
- Ciclo: asegurar el perfil remoto (pasa de `app/(app)/_layout.tsx` al motor) → enviar lotes hasta
  que no queden pendientes → descargar páginas hasta `has_more: false`. Sin perfil remoto el ciclo
  no envía, porque `groups.created_by` lo exige, pero sí descarga, y lo reintenta en el siguiente.
- Fallas: sin red, estado "sin conexión" hasta reconectar o volver al primer plano. Error del
  servidor o tiempo agotado (20 s por llamada): reintentos a los 5 s, 15 s, 45 s, 2 min y luego cada
  5 min, con variación aleatoria. Un 400 (error de programación): estado "error".
- El token lo renueva supabase-js antes de cada llamada. Si la sesión ya no sirve, el
  `AuthProvider` de la Fase 3 la cierra.

### Estado e indicador

- Estados: **sincronizado** (nada pendiente), **pendiente** (cambios por subir o un ciclo en curso),
  **sin conexión** y **error** (envíos apartados o falla del servidor). Además: cuántos cambios
  pendientes, cuántos apartados y la última sincronización completa.
- Un ícono discreto en el encabezado de Grupos: nube con ✓, nube con flecha, nube tachada o nube
  con alerta, en los colores del tema. Área táctil de 44 px y nombre accesible ("Sincronización:
  sincronizado").
- Al tocarlo, una hoja con el estado en palabras, "N cambios sin subir", "Última sincronización:
  hace 2 minutos" y **Sincronizar ahora**. Con envíos apartados: "N cambios no se pudieron subir.
  Siguen en este teléfono." y **Reintentar**.

### Cerrar sesión, borrar la cuenta y reiniciar la base local

- **Cerrar sesión y borrar los datos del teléfono:** la confirmación ya no dice que nada está en la
  nube. Sin pendientes: "Tus datos están guardados en la nube; al volver a entrar se descargan." Con
  pendientes: "Hay N cambios sin subir: si borras los datos, se pierden."
- **Borrar la cuenta:** la lista dice que también se borran tus grupos en la nube.
- **Clave perdida (pendiente de CLAUDE.md):** la pantalla de error de la base suma "Reiniciar los
  datos de este teléfono". Tras confirmar, borra la base de la cuenta, su clave y su registro, abre
  una base nueva y la sincronización descarga todo. Lo que no se había subido ya era ilegible sin la
  clave.

## Cómo se ve un conflicto en la app

| Situación                                                                       | Qué ve el usuario                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El mismo gasto editado en el teléfono y en la tablet, los dos sin conexión      | Gana la edición que sincroniza última, completa (montos, pagadores y partes). El otro dispositivo lo ve cambiar solo al sincronizar. Sin mensaje: es una actualización normal |
| Un formulario abierto sobre algo que cambió en otro dispositivo                 | Al guardar, el mensaje que ya existe: "Esto cambió mientras lo editabas. Vuelve a abrirlo para ver la última versión."                                                        |
| Editaste algo que otro dispositivo borró                                        | Desaparece y un aviso dice: "No se aplicó tu cambio en «Cena»: se borró en otro dispositivo."                                                                                 |
| Borraste algo que otro dispositivo editó                                        | Queda borrado en todos, sin mensaje                                                                                                                                           |
| Renombraste un grupo que otro dispositivo archivó                               | El grupo queda archivado con el nombre nuevo                                                                                                                                  |
| Registraste un gasto sin conexión y otro dispositivo cambió la moneda del grupo | El gasto desaparece y un aviso dice: "No se guardó «Taxi»: la moneda del grupo cambió en otro dispositivo. Vuelve a registrarlo."                                             |
| Cambiaste la moneda de un grupo que ya tiene movimientos en otro dispositivo    | Vuelve la moneda anterior y un aviso dice: "No se cambió la moneda de «Viaje»: el grupo ya tiene movimientos."                                                                |
| Un envío que el servidor no acepta por otra razón                               | El indicador pasa a "error". La hoja dice cuántos cambios no se pudieron subir, que siguen en el teléfono, y ofrece "Reintentar"                                              |

Los avisos usan el `Toast` de la app, sin "Deshacer", y se leen con el lector de pantalla.

## Realtime

- **Qué daría:** que otro dispositivo vea un cambio en segundos sin abrir ni volver a la app.
- **Opciones:** Postgres Changes revisa RLS por cada cambio y cada suscriptor, y Supabase lo
  desaconseja a escala. Broadcast desde la base (un trigger que avisa por un canal privado por
  grupo) necesita Realtime Authorization con políticas en `realtime.messages`.
- **Costo:** un websocket abierto mientras la app está en primer plano, más configuración y pruebas
  del remoto.
- **Valor en la Fase 4a:** bajo. Con una cuenta por grupo, rara vez se usan dos dispositivos a la
  vez, y el ciclo al abrir, al volver y al escribir ya los mantiene al día.
- **Recomendación:** dejarlo para la Fase 4b, cuando los grupos sean compartidos. Entraría como un
  aviso ("cambió el grupo X") que dispara un ciclo, un disparador más del motor. Los datos seguirían
  llegando por `sync_pull`, que valida y aplica cada grupo completo.

## Seguridad

- Toda escritura pasa por `sync_push`, con RLS y privilegios por columna adentro. Las reglas de
  integridad viven en la base (CHECK, FKs, triggers), no solo en la RPC.
- Nada de lo que define identidad o auditoría viene del cliente: `created_by`, fechas, `version`,
  `change_seq`. `user_id` solo puede ser la cuenta de la sesión, y el rol `owner` solo lo inserta el
  creador.
- Límites: 50 envíos por llamada, 50 pagadores y 50 partes por gasto, entre 100 y 5000 filas por
  descarga, 1000 cursores y 20 s por llamada en la app.
- La app valida con zod todo lo que llega del servidor antes de escribirlo.
- Los registros no incluyen montos, nombres ni tokens. Solo códigos y conteos.
- Al cerrar: revisión con la skill security-code-review y `check:data-api` contra el remoto.

## Pruebas

- **pgTAP** (`supabase/tests/database`):
  - `007-sync-columnas`: columnas del servidor, `change_seq` por grupo, la guardia, la moneda
    bloqueada, `group_currency` y "soy yo";
  - `008-sync-push`: alta de grupo, miembros y gasto; reenvío idéntico sin duplicados; último en
    llegar; borrar gana; archivar gana; moneda y "soy yo" con versión vieja; sumas inválidas;
    parte editada; grupo ajeno; lote demasiado grande; un envío inválido no frena a los demás;
    cambio idéntico sin versión nueva;
  - `009-sync-pull`: cursores, grupos completos, páginas, borrados incluidos, solo grupos con
    acceso, `anon` sin acceso;
  - `010-borrar-cuenta`: se borran los grupos no compartidos y quedan los compartidos;
  - `000` a `006` se ajustan: las pruebas de RLS escriben con la marca de `sync_push`, que
    `tests.autenticar_como` pone por omisión.
- **Motor con TDD**, en Jest contra el SQL real (PGlite con las migraciones de Supabase y un
  transporte que puede fallar a propósito):
  - dos dispositivos con la misma cuenta que convergen;
  - cortes de red antes de enviar y después del commit (respuesta perdida);
  - reintentos sin duplicar;
  - conflictos de la tabla anterior;
  - descarga por páginas;
  - subida inicial de datos viejos;
  - una segunda cuenta que no ve nada de la primera.
- **Programación y estado** con un servidor falso y temporizadores falsos: espera de 2 s, un ciclo
  a la vez, reintentos, reconexión y primer plano.
- **Pantallas** con RNTL: indicador, hoja, avisos, textos de cerrar sesión y reinicio de la base.
- **Flujo completo:** la app crea un grupo y un gasto, el indicador pasa de pendiente a
  sincronizado y un segundo dispositivo los descarga, contra PGlite.
- **En el teléfono, al cierre:** APK de preview sin internet (abrir, registrar, ver "pendiente",
  reconectar), el teléfono y el emulador con la misma cuenta, y reinstalar para ver la descarga.

## Pendientes para la Fase 4b o después

- Invitaciones, unirse a grupos y borrar una cuenta con grupos compartidos.
- Perfiles de otras cuentas: `created_by` y `user_id` de otras personas necesitan su fila local en
  `users` (las FKs locales hoy apuntan solo a la cuenta propia).
- Perder el acceso a un grupo: `sync_pull` debería avisar qué grupos ya no ves.
- Realtime como aviso de cambios.
- Fusión por campo si los choques en grupos compartidos se vuelven frecuentes.
- Purga de `private.sync_mutations` si crece.
- Rescatar como borrador un movimiento nuevo que el servidor rechazó, en lugar de solo avisar.
