# Fase 4a — Diseño: sincronización con Supabase

Aprobado el 2026-10-14 con siete ajustes de la revisión, ya incorporados:

1. Ningún conflicto borra datos del usuario: lo rechazado queda como borrador local por revisar.
2. Concurrencia optimista estricta: un cambio con versión base vieja se rechaza, la app avisa y
   guarda su versión como borrador. Se prueba con dos dispositivos simulados.
3. Historial de cambios en el servidor, de solo agregar, escrito por las RPC.
4. Cerrar sesión y borrar los datos ofrece sincronizar primero si hay cambios sin subir.
5. La descarga es incremental por `change_seq`; completa solo la primera vez o al reiniciar.
6. Límites de lote, de payload y de cada campo, validados en el servidor y probados con pgTAP.
7. Pendiente para la 4b: el acceso del creador pasa a depender de la membresía.

Se aprobaron también tres decisiones de la propuesta: el creador de un grupo siempre tiene acceso,
borrar la cuenta borra en la nube sus grupos no compartidos y los gastos que llegan a un grupo
archivado se aceptan.

El avance paso a paso está en `progreso.md` y las tareas en `plan.md`.

## Objetivo

Que los datos de cada cuenta vivan en Supabase y se sincronicen entre sus dispositivos, sin perder
el funcionamiento offline-first. La base local sigue siendo la fuente de verdad de la UI: la app
lee y escribe siempre en SQLite, y la sincronización sube y baja cambios por detrás.

En la Fase 4a cada grupo tiene una sola cuenta (todavía no hay invitaciones). Sincronizar es, por
ahora, mantener iguales tus dispositivos y la copia en la nube. El protocolo ya sirve para grupos
compartidos: el acceso lo decide RLS, el cursor es por grupo y los conflictos se detectan igual
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

| Tema               | Decisión                                                                                                                                                 | Alternativas descartadas                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cola de envío      | Pendiente = fila con `version` distinta de `synced_version`. `sync_outbox` guarda cada envío en curso: su id y su contenido exacto                       | Tabla outbox escrita por cada repositorio: una escritura nueva puede olvidarla. Triggers de SQLite: necesitan una bandera para ignorar lo que escribe la sincronización |
| Cursor de descarga | Contador por grupo en el servidor (`change_seq`), asignado bajo el candado del contador del grupo                                                        | Secuencia global: un commit tardío deja huecos y exige una ventana con `xmin`. `updated_at`: depende de relojes                                                         |
| Escrituras         | RPC `sync_push` con `SECURITY INVOKER`: RLS y los privilegios por columna aplican adentro. Un trigger rechaza las escrituras directas                    | `SECURITY DEFINER` con chequeos propios: se salta RLS y un olvido es una fuga. Un rol propio dueño de la RPC: más piezas que mantener en Supabase                       |
| Concurrencia       | Optimista estricta: cada cambio lleva su versión base y el servidor lo rechaza si tiene una más nueva. El gasto con sus pagadores y partes es una unidad | Gana el último en llegar: pisa cambios ajenos sin avisar. Fusión por campo: exige guardar la versión base de cada campo                                                 |
| Cambio rechazado   | La app vuelve al estado del servidor, avisa y guarda su versión en `sync_conflicts` hasta que el usuario la revisa. Ningún conflicto borra datos         | Descartarlo tras el aviso: se pierde si el aviso pasa desapercibido                                                                                                     |
| Historial          | `change_log`, de solo agregar, escrita por las RPC: una entrada por cambio aplicado con quién, qué y cuándo. La leen quienes tienen acceso al grupo      | Triggers por fila: una entrada por cada parte de un gasto y también lo que no viene de la app                                                                           |
| Descarga           | Incremental por grupo: solo lo que cambió desde su cursor, sin partir un grupo entre páginas, aplicado en una transacción                                | Registro de eventos: crece sin límite y repite trabajo                                                                                                                  |
| Acceso a un grupo  | Su creador o un miembro vinculado activo. En la 4b pasa a depender de la membresía                                                                       | Solo miembros vinculados: un grupo sin "yo" ("Ninguno de ellos", permitido desde la Fase 2) no se podría subir                                                          |
| Realtime           | Después, en la Fase 4b (sección "Realtime")                                                                                                              | Ahora: con una cuenta por grupo aporta poco                                                                                                                             |
| Detección de red   | `expo-network` (módulo del SDK)                                                                                                                          | `@react-native-community/netinfo`: hace lo mismo y no es del SDK                                                                                                        |
| Pruebas del motor  | Contra el SQL real: PGlite 0.5.8 (Postgres en WASM) dentro de Jest                                                                                       | Un servidor falso en TypeScript: dos implementaciones de las reglas que pueden divergir                                                                                 |

## Cómo funciona, de punta a punta

```
Escribir (repositorio) ─► fila pendiente (version ≠ synced_version)
        │                     │ espera de 2 s para agrupar
        ▼                     ▼
  bus 'local'  ─────────► ciclo de sincronización (uno a la vez)
                              1. perfil remoto asegurado
                              2. envío por lotes ──► sync_push ──► aplicado o rechazado
                                                     (rechazado: estado del servidor + borrador)
                              3. descarga incremental ◄── sync_pull(cursores por grupo)
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
  ellos"). Con acceso solo para miembros vinculados, ese grupo no se podría subir ni leer.
- **En la Fase 4b** (pendiente en CLAUDE.md): con invitaciones y expulsiones, el acceso del creador
  pasa a depender de la membresía. Si no, un creador expulsado seguiría viendo el grupo.

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

### Concurrencia

Cada cambio lleva `base`: la versión del servidor que el dispositivo tenía cuando lo hizo.

| Caso                                                                  | Resultado                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `base` es la `version` actual del servidor                            | Se aplica                                                   |
| El servidor tiene una versión más nueva                               | `rejected: conflict`, con el estado actual del servidor     |
| El cambio deja la unidad igual a como está en el servidor             | Se acepta sin escribir (`applied`), aunque `base` sea vieja |
| Unidad nueva (`base` nula) que no existe en el servidor               | Se crea                                                     |
| `base` de una unidad que ya no existe en el servidor                  | `failed: not_found`                                         |
| "Soy yo" sobre un miembro cuando otro ya tiene tu cuenta en ese grupo | `rejected: conflict` (alguien movió "soy yo" en otro lado)  |
| Cambio de moneda con movimientos activos en el servidor               | `rejected: currency_locked`                                 |
| Movimiento calculado con otra moneda de grupo                         | `rejected: group_currency_changed`                          |

- Vale igual para editar, borrar, restaurar, archivar y desarchivar: con una base vieja, nada se
  aplica. Nadie pisa un cambio que no vio.
- **Gasto como unidad:** su `version` sube con cualquier cambio de sus pagadores o partes, así que
  la base del gasto cubre todo. Nunca quedan pagadores de un cambio con partes de otro.
- **Lo propio no choca consigo mismo:** un reenvío con el mismo id devuelve el resultado guardado
  (sección "Idempotencia"), y un cambio hecho mientras el anterior viajaba sale con la base que
  devolvió el servidor.
- **Grupo archivado (decisión aprobada):** un gasto nuevo en un grupo que otro dispositivo archivó
  se guarda y el grupo sigue archivado. Un alta no tiene versión vieja con la que chocar, y
  rechazarla haría perder lo escrito sin conexión. El archivado es de solo lectura en la app, pero no
  es una barrera de seguridad: cualquier miembro lo desarchiva. Lo mismo pasa con un grupo borrado:
  el gasto queda guardado en la nube dentro del grupo borrado.
- **Quitar miembros:** las reglas "sin saldo" y "no el último" las sigue revisando la app. Si un
  dispositivo quita a Beto mientras otro registra un gasto nuevo con él, el servidor guarda ambos y
  Beto aparece en Saldos con la nota "ya no está en el grupo", un estado que la app ya muestra desde
  la Fase 2.

### `sync_push(p_mutations jsonb) → jsonb`

`SECURITY INVOKER`, `set search_path = ''`, solo para `authenticated`. Recibe hasta 50 envíos:

```json
{ "id": "<uuid del envío>", "entity": "expense", "base": 3, "data": { "...": "..." } }
```

- `data` por unidad (exactamente estas claves; una clave desconocida es un error):
  - `group`: `id`, `name`, `currency`, `emoji`, `color`, `archived`, `deleted`.
  - `member`: `id`, `group_id`, `display_name`, `user_id`, `role`, `deleted`.
  - `category` (personalizada): `id`, `group_id`, `name`, `icon`, `deleted`.
  - `expense`: `id`, `group_id`, `kind`, `title`, `amount`, `currency`, `group_currency`,
    `group_amount`, `exchange_rate`, `rate_date`, `split_method`, `category_id`, `occurred_on`,
    `notes`, `deleted`, `payers` (`id`, `member_id`, `amount`, `group_amount`) y `splits` (lo mismo
    más `input_value`), solo los activos.
  - `transfer`: `id`, `group_id`, `from_member_id`, `to_member_id`, `amount`, `currency`,
    `group_currency`, `group_amount`, `exchange_rate`, `rate_date`, `occurred_on`, `deleted`.
- El servidor nunca toma del cliente `created_by` (es siempre `auth.uid()`), las fechas de
  auditoría, `version` ni `change_seq`.

Responde una lista en el mismo orden:

```json
{ "id": "...", "status": "applied", "version": 4, "current": [{ "table": "expenses", "row": {} }] }
{ "id": "...", "status": "rejected", "reason": "conflict", "current": [] }
{ "id": "...", "status": "failed", "reason": "invalid", "field": "title" }
```

- `applied`: se aplicó, o ya se había aplicado (reenvío). `version` es la que dejó este envío y
  `current` el estado actual en el servidor: la fila, o el gasto con todos sus pagadores y partes.
- `rejected`: `conflict`, `currency_locked` o `group_currency_changed`. `current` trae el estado del
  servidor, vacío si la unidad no existe allí.
- `failed`: algo que no debería pasar con una app correcta: `forbidden` (RLS), `invalid` (datos o
  sumas, con el campo), `not_found` o `error`. El cliente conserva sus datos y aparta el envío.

**Cómo procesa:**

1. Valida el sobre (sección "Límites"). Si falla, la llamada entera responde un error: es un error
   de programación.
2. Recorre los envíos en el orden recibido; la app los manda ordenados por grupo. Antes de tocar un
   grupo bloquea su contador, así dos llamadas sobre el mismo grupo esperan en vez de cruzarse (sin
   interbloqueos entre filas).
3. Por envío: candado `pg_advisory_xact_lock` sobre su id; si ya figura en `private.sync_mutations`,
   responde `applied` con la versión guardada y el estado actual, sin volver a aplicarlo.
4. Valida cada campo, bloquea la fila (`FOR UPDATE`), compara con `base` y aplica, todo dentro de un
   bloque `BEGIN ... EXCEPTION` (un punto de guardado): si falla, se deshace solo ese envío y la RPC
   sigue con los demás. Los interbloqueos (`40P01`) y los errores de serialización se relanzan: la
   llamada entera falla y el cliente la repite.
5. Si escribió algo, registra el envío en `private.sync_mutations` y una entrada en `change_log`.

Con 50 envíos por llamada, la RPC queda por debajo de las 64 subtransacciones que Postgres guarda
en memoria por sesión.

**Validación por unidad** (además de los CHECK, las FKs y las reglas):

- Un gasto activo tiene de 1 a 50 pagadores y de 1 a 50 partes, sin miembros repetidos. Los
  pagadores suman `amount` y `group_amount`, y las partes también. Si `currency` es la del grupo,
  la tasa es `1` y `group_amount = amount` en el gasto y en cada parte. Un gasto borrado viene sin
  partes.
- Las partes no se editan: una parte que ya existe solo cambia `deleted_at`. Una edición crea partes
  nuevas, como en la base local.
- `group_id` de una fila existente no cambia.

**Gasto como unidad.** Si aplica: marca borradas las partes activas que no vienen, después crea o
reactiva las que vienen (primero liberar, para no chocar con el índice único de miembro por gasto)
y toca el gasto para que su `version` suba con cualquier cambio de sus partes.

### Límites

El servidor valida todo antes de escribir, con estos topes:

| Qué                                      | Límite                                                                                                                                 | Si se pasa                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Envíos por llamada a `sync_push`         | 0 a 50                                                                                                                                 | Error de la llamada (400)      |
| Tamaño de `p_mutations`                  | 512 KiB                                                                                                                                | Error de la llamada (413)      |
| Sobre de cada envío                      | Solo `id` (UUID), `entity` (una de las cinco), `base` (nula o entero ≥ 1) y `data` (objeto)                                            | Error de la llamada (400)      |
| Claves de `data`                         | Solo las de su unidad                                                                                                                  | `failed: invalid` con el campo |
| Textos                                   | Nombres 1–80, título 1–120, notas hasta 1000, emoji 1–16, categoría 1–40, ícono 1–40, tasa hasta 32; sin textos vacíos o solo espacios | `failed: invalid` con el campo |
| Montos                                   | Enteros JSON (no texto ni decimales): 1 a 99 999 999 999 999; los convertidos y las partes desde 0                                     | `failed: invalid` con el campo |
| Monedas, tasas, fechas, ids y enumerados | ISO de 3 letras, decimal positivo, `YYYY-MM-DD` que exista, UUID y valores conocidos                                                   | `failed: invalid` con el campo |
| Pagadores y partes por gasto             | 1 a 50 cada uno (0 si el gasto está borrado)                                                                                           | `failed: invalid` con el campo |
| Cursores en `sync_pull`                  | Hasta 1000 grupos; claves UUID; valores enteros de 0 a 9 007 199 254 740 991                                                           | Error de la llamada (400)      |
| Filas por respuesta de `sync_pull`       | `p_max_rows` de 100 a 5000                                                                                                             | Error de la llamada (400)      |
| Tiempo por llamada en la app             | 20 s                                                                                                                                   | Se reintenta                   |

- Los textos y montos coinciden con los CHECK de las tablas y con la validación de la app. El tope de
  montos de la app baja de `Number.MAX_SAFE_INTEGER` a 99 999 999 999 999, el del servidor: así la
  app no guarda algo que después no puede subir.
- Los errores de la llamada usan `22023` (400) y `54000` (413), que PostgREST traduce a esos estados.
- La app arma lotes de hasta 50 envíos y 256 KiB: un gasto con 50 pagadores, 50 partes y notas
  largas ocupa unos 20 KiB, así que siempre cabe.

### Idempotencia

- Cada envío tiene un id (UUID) que se genera una vez y se guarda en el teléfono con el contenido
  exacto. Si no llega la respuesta, el teléfono repite **el mismo envío**.
- El servidor guarda los envíos aplicados en `private.sync_mutations (user_id, mutation_id, entity,
entity_id, version, applied_at)`, con clave `(user_id, mutation_id)`. Un envío repetido devuelve
  el resultado guardado y no vuelve a aplicar nada: sin filas, versiones ni entradas de historial de
  más.
- Los ids de las filas son UUID v7 generados en el cliente: repetir un alta nunca duplica una fila.
- El candado por id de envío cubre el caso de dos llamadas con el mismo envío a la vez (una que se
  dio por perdida y su reintento).
- Los envíos rechazados no se guardan: si se repiten, se vuelven a evaluar sin efectos.
- Las funciones que leen y escriben `private.sync_mutations` son `SECURITY DEFINER` y solo tocan las
  filas de `auth.uid()`. Se borran en cascada con la cuenta. No se purgan en esta fase (son unos 100
  bytes por cambio).

### Historial de cambios

`public.change_log`, de solo agregar:

| Columna               | Qué guarda                                                                     |
| --------------------- | ------------------------------------------------------------------------------ |
| `id`                  | `bigint` generado: el orden de los cambios                                     |
| `group_id`            | El grupo (FK con `on delete cascade`)                                          |
| `entity`, `entity_id` | Qué cambió: grupo, miembro, categoría, gasto o transferencia, y su id          |
| `action`              | `create`, `update`, `delete` o `restore`                                       |
| `fields`              | Los campos que cambiaron (`payers` y `splits` para las partes de un gasto)     |
| `snapshot`            | La unidad completa después del cambio (el gasto con sus pagadores y partes)    |
| `version`             | La versión que dejó el cambio                                                  |
| `actor`               | Quién: `auth.uid()`. Sin FK, para no tener que editarlo si esa cuenta se borra |
| `mutation_id`         | El envío que lo produjo                                                        |
| `changed_at`          | Cuándo: `now()` del servidor                                                   |

- **La escriben las RPC:** `sync_push` llama a `private.record_change(...)` (`SECURITY DEFINER`, que
  toma el autor de `auth.uid()` y revisa el acceso al grupo) por cada cambio aplicado. Un reenvío,
  un cambio idéntico o un rechazo no escriben nada. En la 4b, las RPC de invitaciones harán lo mismo.
- **La leen** quienes pueden abrir el grupo: RLS con `private.can_access_group(group_id)`.
- **Nadie la edita ni la borra:** ni `anon`, ni `authenticated`, ni `service_role` tienen `INSERT`,
  `UPDATE`, `DELETE` ni `TRUNCATE`. Un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE` también para
  `postgres`. Solo deja pasar el `DELETE` que llega en cascada al borrar un grupo con la cuenta (el
  trigger lo reconoce porque corre anidado en otro trigger). Quitar esa protección exige ser dueño de
  la tabla y desactivar el trigger: la garantía es para los roles de la API.
- Sin pantalla en esta fase. En la 4b servirá para "quién cambió qué".

### `sync_pull(p_cursors jsonb, p_max_rows integer default 2000) → jsonb`

`SECURITY INVOKER` y `STABLE`: todas sus consultas ven la misma foto de la base, así que no puede
devolver un gasto sin el miembro que creó la transacción siguiente.

- **Incremental.** `p_cursors` es `{ "<id de grupo>": <change_seq>, ... }`. Por cada grupo visible por
  RLS (los tuyos, borrados incluidos) devuelve solo las filas con `change_seq` mayor que su cursor.
- **Completa solo con el cursor en 0:** la primera vez en un dispositivo (base nueva), después de
  "Reiniciar los datos de este teléfono" o, en la 4b, al unirse a un grupo. En los demás casos baja
  solo lo nuevo.
- Junta grupos con cambios, ordenados por id, hasta `p_max_rows` filas. Los cambios de un grupo
  nunca se parten entre páginas: si un grupo solo supera el límite, sale solo en su página.

```json
{
  "groups": [{ "id": "<uuid>", "cursor": 57, "rows": [{ "table": "group_members", "row": {} }] }],
  "has_more": false
}
```

- Cada fila va con todas sus columnas, también las borradas lógicamente. `cursor` es el `change_seq`
  más alto del grupo en esa foto.
- Por qué no partir un grupo: lo que se descarga es el estado actual de lo que cambió, no un
  registro. Una fila cambiada otra vez después queda con su `change_seq` nuevo, y cortar los cambios
  de un grupo podría traer un hijo antes que su padre. Las reglas de unicidad y las FKs son todas
  dentro de un grupo, así que sus cambios juntos siempre se pueden aplicar.
- Supabase limita las respuestas de tablas a `max_rows`, pero una función que devuelve un solo
  `jsonb` no se corta.

### Privilegios

| Rol             | Cambio                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticated` | Pierde `UPDATE` de `updated_at` y `version` (las pone el servidor). Gana `UPDATE` de `group_members.user_id` y de `group_currency`. En pagadores y partes, solo `deleted_at`. `SELECT` en `change_log`. `EXECUTE` en `sync_push` y `sync_pull` |
| `authenticated` | `EXECUTE` en las funciones de `private` que llaman las políticas, los triggers y las RPC. `private` sigue fuera de la Data API                                                                                                                 |
| `anon`          | Nada, como hasta ahora                                                                                                                                                                                                                         |
| `service_role`  | Ningún privilegio en las tablas de `public`: igual que el remoto desde el cambio del panel (pendiente de CLAUDE.md). `delete-account` solo usa `auth.admin`                                                                                    |
| Por omisión     | `postgres` en `public` no da nada a `anon`, `authenticated` ni `service_role`: el repo queda igual que el remoto                                                                                                                               |

Postgres da `EXECUTE` a `PUBLIC` en cada función nueva, y eso no se puede quitar por esquema (solo
de forma global, lo que rompería extensiones como pgTAP). Por eso cada función nueva lleva en su
migración `revoke all ... from public, anon, authenticated, service_role` y el `grant` exacto.
`006-privilegios.test.sql` se actualiza con la matriz nueva y `npm run check:data-api` suma:

- `anon` no ejecuta `sync_push` ni `sync_pull` y no lee `change_log` (401 `42501`);
- `authenticated` ejecuta `sync_pull` (200, sin grupos para `prueba1`) y `sync_push` con una lista
  vacía (200, `[]`), lee `change_log` (vacío) y no le escribe;
- un `POST` directo a `groups` con un nombre vacío responde `42501` de la guardia. Si la guardia
  faltara, respondería `23514` (CHECK) y tampoco escribiría nada.

### Borrar la cuenta

Un trigger `BEFORE DELETE` en `profiles` (corre en la cascada de `auth.admin.deleteUser`) borra los
grupos que nadie más podría abrir: los creados por la cuenta o con su miembro, sin otro miembro
vinculado activo. En la Fase 4a son todos los grupos de la cuenta, y sus filas y su historial caen
en cascada. Sin esto, borrar la cuenta dejaría sus gastos huérfanos en la nube. Es lo que ya
promete la pantalla de borrar la cuenta. Lo que pasa con los grupos compartidos sigue en la 4b.

### Migraciones

Cuatro archivos en `supabase/migrations`, aplicados juntos con un `db push` en el punto de control:

1. `<fecha>_sincronizacion_base.sql`: `change_seq`, `group_changes`, `group_currency`, los
   triggers, la guardia, RLS con el acceso del creador y los privilegios.
2. `<fecha>_sync_push.sql`: `sync_mutations`, `change_log`, `sync_push` y sus funciones de apoyo.
3. `<fecha>_sync_pull.sql`: `sync_pull`.
4. `<fecha>_borrar_cuenta_grupos.sql`: el trigger de `profiles`.

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
- `sync_conflicts (id, entity, entity_id, group_id, reason, payload, server_deleted, was_new,
was_deletion, created_at)`: los borradores por revisar (sección siguiente).
- Índices parciales de filas pendientes, para contarlas y recorrerlas sin leer toda la tabla.
- Las 9 categorías predefinidas quedan sincronizadas (existen iguales en el servidor). Todo lo demás
  queda pendiente: **la primera sincronización sube todo lo creado en las Fases 1 a 3**, incluidos
  los grupos sin "yo" y los miembros quitados que siguen en movimientos viejos.

Los repositorios guardan `group_currency` al registrar o editar un movimiento. Restaurar un
movimiento borrado cuya moneda de grupo ya no es la actual se rechaza (`CURRENCY_CHANGED`): hoy la
app lo permitiría y dejaría montos en otra moneda. El tope de los montos baja a
99 999 999 999 999, el del servidor.

### Unidades de sincronización

- **Una fila:** grupo, miembro, categoría personalizada (todavía sin pantalla) y transferencia.
- **Un gasto o ingreso** con sus pagadores y partes activos. Toda escritura de partes sube la
  `version` del gasto, así que la unidad está pendiente si el gasto lo está.

### Envío

1. Toma hasta 50 unidades pendientes y no apartadas (y hasta 256 KiB), ordenadas por grupo y, dentro
   del grupo, por dependencias: grupo, miembros, categorías, gastos y transferencias.
2. Antes de enviarlas las guarda en `sync_outbox` con un id nuevo y el contenido exacto. Si una
   unidad ya tenía un envío sin respuesta, repite ese mismo.
3. Con la respuesta:
   - `applied`: si la unidad no cambió mientras viajaba, aplica `current` y queda al día. Si cambió,
     solo guarda `server_version` y sigue pendiente: el próximo lote lleva lo nuevo con la base
     correcta.
   - `rejected`: guarda la versión del teléfono como borrador en `sync_conflicts`, aplica `current`
     (si viene vacío, la unidad sale de los movimientos y sus datos quedan en el borrador) y emite un
     aviso.
   - `failed`: deja el envío apartado y los datos como están. El estado pasa a "error". Se reintenta
     al abrir la app de nuevo o con "Reintentar".
4. Sin red, con un error del servidor o sin respuesta, el envío queda en `sync_outbox` y se repite
   igual en el próximo intento.

### Borradores por revisar

Nada se pierde por un conflicto. La versión rechazada queda en `sync_conflicts` (en la base cifrada,
sin sincronizar) hasta que el usuario decide:

| Borrador                                        | Acciones                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gasto, ingreso o transferencia (edición o alta) | **Revisar** abre el formulario con tu versión: si el movimiento sigue activo, como edición sobre la versión actual; si no existe o se borró, como movimiento nuevo (con la moneda actual del grupo). Al guardar, el borrador se va. **Descartar** |
| Un borrado que no se aplicó                     | **Borrar ahora** (sobre la versión actual) o **Mantener**                                                                                                                                                                                         |
| Grupo o miembro                                 | Muestra tu versión junto a la actual en los campos que difieren (nombre, moneda, emoji, color, archivado, "soy yo"). **Entendido**: el cambio se repite a mano si se quiere                                                                       |

- Aviso al ocurrir, con la acción **Revisar**.
- Un aviso fijo en el detalle del grupo: "N cambios por revisar", que abre la lista del grupo.
- La hoja de sincronización cuenta los borradores de todos los grupos.
- El formulario se llena con `valuesFromExpense` y `valuesFromTransfer`, que ya existen para editar.

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
  el servidor no tiene: las de un cambio rechazado (sus datos están en el borrador) o restos locales
  ya borrados.
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
  5 min, con variación aleatoria. Un 400 o un 413 (error de programación): estado "error".
- El token lo renueva supabase-js antes de cada llamada. Si la sesión ya no sirve, el
  `AuthProvider` de la Fase 3 la cierra.

### Estado e indicador

- Estados: **sincronizado** (nada pendiente), **pendiente** (cambios por subir o un ciclo en curso),
  **sin conexión** y **error** (envíos apartados o falla del servidor). Además: cuántos cambios
  pendientes, cuántos apartados, cuántos borradores por revisar y la última sincronización completa.
- Un ícono discreto en el encabezado de Grupos: nube con ✓, nube con flecha, nube tachada o nube
  con alerta, en los colores del tema. Área táctil de 44 px y nombre accesible ("Sincronización:
  sincronizado").
- Al tocarlo, una hoja con el estado en palabras, "N cambios sin subir", "Última sincronización:
  hace 2 minutos" y **Sincronizar ahora**. Con envíos apartados: "N cambios no se pudieron subir.
  Siguen en este teléfono." y **Reintentar**. Con borradores: "N cambios por revisar" y los grupos
  donde están.

### Cerrar sesión, borrar la cuenta y reiniciar la base local

- **Cerrar sesión** (sin borrar): los datos quedan cifrados en el teléfono y lo que no se subió se
  sube al volver a entrar. El texto lo dice.
- **Cerrar sesión y borrar los datos del teléfono:**
  - sin cambios pendientes ni borradores: "Tus grupos y movimientos están guardados en la nube. Al
    volver a entrar se descargan." y **Borrar y cerrar sesión**;
  - con cambios pendientes o borradores: "Hay N cambios sin subir y M borradores por revisar. Si
    borras los datos ahora, se pierden." con **Sincronizar primero**, **Borrar de todos modos** y
    **Cancelar**. Sincronizar primero corre un ciclo y espera: si todo subió y no quedan borradores,
    sigue con la confirmación normal; si no (sin conexión, por ejemplo), vuelve a avisar con los
    números nuevos. Los borradores no se suben solos: hay que revisarlos.
  - Sale el texto que decía que los datos todavía no se guardan en la nube.
- **Borrar la cuenta:** la lista dice que también se borran tus grupos en la nube.
- **Clave perdida (pendiente de CLAUDE.md):** la pantalla de error de la base suma "Reiniciar los
  datos de este teléfono". Tras confirmar, borra la base de la cuenta, su clave y su registro, abre
  una base nueva y la sincronización la descarga completa. Lo que no se había subido ya era ilegible
  sin la clave.

## Cómo se ve un conflicto en la app

| Situación                                                                       | Qué ve el usuario                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El mismo gasto editado en el teléfono y en la tablet, los dos sin conexión      | Queda el que sincroniza primero. En el otro, el gasto vuelve a esa versión y un aviso dice: "«Cena» cambió mientras estabas sin conexión. Guardamos tu versión para que la revises."      |
| Editaste algo que otro dispositivo borró                                        | Desaparece y un aviso dice: "«Cena» se borró en otro dispositivo. Guardamos tu versión para que la revises." Al revisarla se puede registrar de nuevo                                     |
| Borraste algo que otro dispositivo editó                                        | Vuelve con la versión nueva y un aviso dice: "No se borró «Cena»: cambió mientras estabas sin conexión." Al revisarlo: "Borrar ahora" o "Mantener"                                        |
| Cambiaste un grupo o un miembro que cambió en otro dispositivo                  | Vuelve la versión del servidor y un aviso dice: "No se aplicó tu cambio en «Viaje»: cambió mientras estabas sin conexión." En "por revisar" se ve tu versión junto a la actual            |
| Registraste un gasto sin conexión y otro dispositivo cambió la moneda del grupo | Sale de los movimientos (sus montos estaban en la moneda vieja) y queda como borrador. Aviso: "«Taxi» no se guardó: la moneda del grupo cambió. Quedó como borrador para que lo revises." |
| Cambiaste la moneda de un grupo que ya tiene movimientos en otro dispositivo    | Vuelve la moneda anterior y un aviso dice: "No se cambió la moneda de «Viaje»: el grupo ya tiene movimientos."                                                                            |
| Hiciste el mismo cambio en los dos dispositivos                                 | Nada: el servidor ve que el resultado es igual y lo acepta                                                                                                                                |
| Un formulario abierto sobre algo que cambió en otro dispositivo                 | Al guardar, el mensaje que ya existe: "Esto cambió mientras lo editabas. Vuelve a abrirlo para ver la última versión."                                                                    |
| Un envío que el servidor no acepta por otra razón                               | El indicador pasa a "error". La hoja dice cuántos cambios no se pudieron subir, que siguen en el teléfono, y ofrece "Reintentar"                                                          |

Los avisos usan el `Toast` de la app con la acción "Revisar" y se leen con el lector de pantalla.

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
  llegando por `sync_pull`, que valida y aplica los cambios de cada grupo juntos.

## Seguridad

- Toda escritura pasa por `sync_push`, con RLS y privilegios por columna adentro. Las reglas de
  integridad viven en la base (CHECK, FKs, triggers), no solo en la RPC.
- Nada de lo que define identidad o auditoría viene del cliente: `created_by`, fechas, `version`,
  `change_seq`, el autor del historial. `user_id` solo puede ser la cuenta de la sesión, y el rol
  `owner` solo lo inserta el creador.
- Límites de lote, payload y campos validados en el servidor (sección "Límites").
- `change_log` no se edita ni se borra desde la API.
- La app valida con zod todo lo que llega del servidor antes de escribirlo.
- Los registros no incluyen montos, nombres ni tokens. Solo códigos y conteos.
- Al cerrar: revisión con la skill security-code-review y `check:data-api` contra el remoto.

## Pruebas

- **pgTAP** (`supabase/tests/database`):
  - `007-sync-columnas`: columnas del servidor, `change_seq` por grupo, la guardia, la moneda
    bloqueada, `group_currency`, "soy yo" y el acceso del creador;
  - `008-sync-push`: altas; reenvío idéntico sin duplicados; base vieja rechazada al editar, borrar,
    restaurar, archivar y en "soy yo"; cambio idéntico aceptado sin escribir; moneda; sumas; partes
    inmutables; grupo ajeno; un envío inválido no frena a los demás; **cada límite** de la tabla;
  - `009-historial`: una entrada por cambio aplicado con autor, acción, campos y versión; nada por
    reenvíos, cambios idénticos o rechazos; lectura solo con acceso al grupo; nadie la edita, la
    borra ni la vacía, salvo la cascada de borrar la cuenta;
  - `010-sync-pull`: incremental por cursor; completa con cursor 0; páginas sin partir grupos;
    borrados incluidos; solo grupos con acceso; **cada límite**; `anon` sin acceso;
  - `011-borrar-cuenta`: se borran los grupos no compartidos con su historial y quedan los
    compartidos;
  - `000` a `006` se ajustan: las pruebas de RLS escriben con la marca de `sync_push`, que
    `tests.autenticar_como` pone por omisión.
- **Motor con TDD**, en Jest contra el SQL real (PGlite con las migraciones de Supabase y un
  transporte que puede fallar a propósito), con **dos dispositivos simulados**:
  - convergen tras cambios en uno y en el otro;
  - conflictos de la tabla anterior: el segundo en sincronizar recibe el rechazo, vuelve a la versión
    del servidor, guarda su borrador y avisa; al guardar el borrador, los dos convergen;
  - cortes de red antes de enviar y después del commit (respuesta perdida), y reintentos sin
    duplicar;
  - descarga incremental: un segundo ciclo sin cambios no baja nada;
  - subida inicial de datos viejos y una segunda cuenta que no ve nada de la primera.
- **Programación y estado** con un servidor falso y temporizadores falsos: espera de 2 s, un ciclo
  a la vez, reintentos, reconexión, primer plano y "Sincronizar ahora".
- **Pantallas** con RNTL: indicador, hoja, avisos, borradores (revisar, borrar ahora, descartar),
  cerrar sesión con "Sincronizar primero" y reinicio de la base.
- **Flujo completo:** la app crea un grupo y un gasto, el indicador pasa de pendiente a
  sincronizado y un segundo dispositivo los descarga, contra PGlite.
- **En el teléfono, al cierre:** APK de preview sin internet (abrir, registrar, ver "pendiente",
  reconectar), el teléfono y el emulador con la misma cuenta (un cambio en cada uno y un conflicto
  con su borrador), y reinstalar para ver la descarga completa.

## Pendientes para la Fase 4b o después

- Invitaciones, unirse a grupos y borrar una cuenta con grupos compartidos.
- **Acceso del creador:** cuando existan invitaciones y expulsiones, debe pasar a depender de la
  membresía (también en CLAUDE.md).
- Perfiles de otras cuentas: `created_by` y `user_id` de otras personas necesitan su fila local en
  `users` (las FKs locales hoy apuntan solo a la cuenta propia).
- Perder el acceso a un grupo: `sync_pull` debería avisar qué grupos ya no ves.
- Pantalla de historial con `change_log` ("quién cambió qué").
- Realtime como aviso de cambios.
- Fusión por campo, si los rechazos en grupos compartidos resultan frecuentes.
- Purga de `private.sync_mutations` si crece.
