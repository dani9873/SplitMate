# Fase 4a — Progreso

> Se actualiza con el commit de cada paso. Si una sesión se corta, se retoma desde
> "Siguiente paso". Tareas en `plan.md`; decisiones en `diseno.md`. El usuario pide detenerse cada
> 2 pasos.

**Siguiente paso:** 11, pantallas: borradores por revisar (lista y resolución; "Revisar" de los avisos
hoy lleva al detalle del grupo, donde irá el banner).

## Pasos

- [x] Diseño y plan aprobados el 2026-10-14, con siete ajustes ya incorporados: borradores en vez
      de borrar datos, concurrencia optimista estricta, historial `change_log`, cerrar sesión con
      "Sincronizar primero", descarga incremental, límites validados en el servidor y el pendiente
      del acceso del creador para la 4b (también en CLAUDE.md).
- [x] 1. Parches de Expo y perfil preview de EAS:
  - `npx expo install --fix`: expo 57.0.28, expo-crypto 57.0.4, expo-dev-client 57.0.20,
    expo-router 57.0.26, expo-splash-screen 57.0.10 y jest-expo 57.0.6. expo-doctor 21/21.
    `npm audit --omit=dev` sin cambios: 68 avisos de los mismos seis paquetes aceptados.
  - Perfil `preview` con `environment: preview`. `EXPO_PUBLIC_SUPABASE_URL` y
    `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` creadas en el entorno `preview` de EAS como sensibles
    (`eas env:set`), comparadas con `.env` sin mostrarlas: iguales.
  - Keystore: eas-cli 24.12.1 lo genera al azar y lo guarda en EAS sin preguntar en modo no
    interactivo (`CreateKeystore.provideOrGenerateAsync`). Lo crea el primer build de preview, al
    cierre; no hace falta que el usuario corra nada antes.
  - `flujo-grupo.test.tsx` pasaba el límite de 20 s con todas las suites en paralelo. No es por los
    parches: con `main` en una copia fuera de OneDrive tardó 15,2 s y en la rama 14,6 s. Ese archivo
    usa `jest.setTimeout(60_000)`. tsc, lint y 676 pruebas en verde.
- [x] 2. Servidor: migración base `20261014093549_sincronizacion_base.sql`:
  - columnas del servidor (`created_at`, `updated_at`, `version`, `deleted_at`, `archived_at`) y
    `change_seq` por grupo con `private.group_changes` y `private.next_change_seq`;
  - guardia: sin la marca de `sync_push`, `authenticated` no escribe en las 7 tablas de grupo;
  - reglas: moneda bloqueada (`SMCUR`), `group_currency` en gastos y transferencias (`SMGCC`) y
    "soy yo" solo con la cuenta propia;
  - RLS con `private.can_access_group` (creador o miembro vinculado); `owner` solo lo agrega el
    creador; sale `can_bootstrap_group`;
  - privilegios: `authenticated` sin `UPDATE` de `updated_at` ni `version`, con `user_id` y
    `group_currency`, y en pagadores y partes solo `deleted_at`; `service_role` sin privilegios en
    `public`, igual que el remoto.

  Banco local `npm run test:db:local` (PGlite 0.5.8 y pgTAP 0.0.9, con
  `supabase/pglite/plataforma.sql`): 178 pruebas en verde, antes 128. `007-sync-columnas`
  es nuevo (46) y `000` a `006` se ajustaron a las reglas nuevas. 12 mutaciones de la migración
  detectadas (guardia, `version`, fechas, moneda, `group_currency`, "soy yo", acceso del creador,
  `owner`, `change_seq`, `service_role` y columnas editables).

  CI verde en el run 38544898812: "Base de datos y RLS" con `Files=8, Tests=178, Result: PASS`
  sobre Postgres 17, y 676 pruebas de Jest.

- [x] 3. Servidor: `sync_push` con concurrencia estricta, límites e historial
      (migración `20261016090000_sync_push.sql`, sin `db push` todavía):
  - `private.sync_mutations` (envíos aplicados, con `sync_find_mutation` y
    `sync_remember_mutation`), `public.change_log` de solo agregar (RLS con `can_access_group`,
    solo `SELECT` para `authenticated`, trigger que rechaza `UPDATE`, `DELETE` y `TRUNCATE` salvo el
    `DELETE` en cascada) y `private.record_change`;
  - validadores que lanzan `SMINV` con el campo (`sync_keys`, `sync_text`, `sync_int`, `sync_uuid`,
    `sync_bool`, `sync_date`, `sync_enum`, `sync_currency`, `sync_rate`, `sync_lines`); el prefijo
    `payers.` o `splits.` de los campos anidados viaja en `splitmate.sync_path`, sin bloques
    `EXCEPTION` (cada uno gasta una subtransacción y el diseño cuenta una por envío);
  - `sync_apply_group`, `_member`, `_category`, `_expense` y `_transfer`: comparan el estado pedido con
    el del servidor (igual: `applied` sin escribir), después la base (`SMCFL`), y escriben; el gasto
    sube su versión con cualquier cambio de pagadores o partes y las partes que ya existen solo
    cambian `deleted_at`;
  - `public.sync_push(jsonb)`: sobre validado entero antes de escribir (22023 y 54000), candado
    por envío, un punto de guardado por envío y cada error mapeado a `rejected` o `failed`
    (`23505` de "soy yo" = conflicto; `23505` de una clave primaria = `forbidden`);
  - decisiones: `base` e `id` del sobre y todas las claves de `data` son obligatorias; un cambio de
    `role` o `group_id` en una fila existente es `invalid`; solo se recuerdan los envíos que
    escribieron algo.

  Pruebas nuevas `008-sync-push` (102) y `009-historial` (44), en verde con
  `npm run test:db:local -- 008` y `-- 009`; `001` y `006` se ajustaron a `change_log` y a las
  funciones nuevas (20 y 6 en verde). 10 mutaciones de la migración detectadas (idempotencia,
  base, cambio idéntico, 50 envíos, 512 KiB, borrado en cascada, sumas de pagadores en las dos
  monedas, privilegios de `anon`, envío recordado y "soy yo"). No se corrió la suite completa:
  el CI es la fuente de verdad para `002`-`005` y `007`.
- [x] 4. Servidor: `sync_pull` incremental, borrar la cuenta borra sus grupos no compartidos y
      `check:data-api` ampliado (sin `db push` todavía):
  - `20261016100000_sync_pull.sql`: `public.sync_pull(p_cursors, p_max_rows)`, en plpgsql
    `STABLE` y `SECURITY INVOKER`. Valida el sobre (`22023`), cuenta las filas con
    `change_seq > cursor` por grupo visible y arma páginas por id, sin partir un grupo (el primero
    entra siempre). Las filas van por tabla (padres antes que hijos) y luego por `change_seq`. Un
    cursor de un grupo que no se ve se ignora; un grupo sin cambios no aparece.
  - `20261016100100_borrar_cuenta_grupos.sql`: trigger `BEFORE DELETE` en `profiles` con
    `private.delete_unshared_groups()` (`SECURITY DEFINER`). Borra los grupos de la cuenta (creados
    por ella o con su miembro activo) que nadie más puede abrir: sin otro miembro vinculado activo
    y sin otro creador, como en `can_access_group`. Sus filas, su historial y su contador caen en
    cascada.
  - `check:data-api`: `change_log` en las tablas revisadas; `anon` no ejecuta `sync_pull` ni
    `sync_push`; `authenticated` las ejecuta (sin grupos y con `[]`), no escribe en `change_log`, y
    un `POST` directo a `groups` con nombre vacío da `42501` de la guardia. Solo se comprobó con
    `node --check` y eslint: corre contra el remoto después del `db push`.

  Pruebas nuevas `010-sync-pull` (39) y `011-borrar-cuenta` (20); `006` suma `sync_pull`.
  `npm run test:db:local` completo: 383 en verde. 11 mutaciones detectadas (filtro incremental,
  límite de página, primer grupo forzado, 1001 cursores, `p_max_rows` 99, cursor negativo, tope
  2^53, orden por tabla, EXECUTE de `anon` (por 001 y 006), acceso del creador y otras cuentas al
  borrar).
- [x] Punto de control (2026-10-16): `db push --dry-run` listó solo las cuatro migraciones de la fase;
      con el permiso del usuario, `supabase db push` las aplicó sin errores y `npm run check:data-api`
      contra el remoto dio "Data API en orden" (31 comprobaciones: `anon` sin tablas ni RPC, `change_log`
      de solo lectura, `sync_pull` y `sync_push([])` en 200, y la guardia en `42501`).
- [x] 5. Base local: columnas y tablas de sincronización (migración 0004):
  - `0004_sincronizacion.sql`: sale de `drizzle-kit generate --name sincronizacion` (no `--custom`,
    que dejaría el snapshot sin las columnas nuevas) y se editó a mano. Revisado: solo `CREATE`,
    `ALTER TABLE ... ADD` e índices; sin `DROP TABLE`, `__new_`, `RENAME` ni `PRAGMA`, así que
    ninguna tabla se reconstruye (con `foreign_keys = ON` podría borrar en cascada gastos y partes).
    Una prueba lee el `.sql` y falla si aparece alguno.
  - `server_version` (nulo = nunca llegó) y `synced_version` (0) en las 7 tablas que se envían;
    `users` no cambia. **Pendiente = `version <> synced_version`**, sin otra marca; índices parciales
    `*_pending_idx` en las 7. Las 9 predefinidas quedan con `synced_version = version`.
  - `group_currency` en `expenses` y `transfers`: columna `NOT NULL DEFAULT 'USD'` (SQLite exige el
    DEFAULT al agregarla) con el CHECK de formato como restricción de columna solo en el `.sql`, y
    relleno con una subconsulta correlacionada a `groups` (no `UPDATE ... FROM`, para no depender de
    la versión de SQLite). En `schema.ts` queda `notNull()` sin default: así `tsc` obliga a los
    repositorios a mandarla. El snapshot no refleja ese DEFAULT; es la única diferencia con el `.sql`.
  - Tablas locales `sync_outbox` (un envío por unidad, `in_flight` o `failed`), `sync_cursors` y
    `sync_conflicts`; sin columnas de sincronización ni claves foráneas.
  - `MAX_MINOR_AMOUNT = 99_999_999_999_999` (tope del servidor) en `validation.ts`;
    `CURRENCY_CHANGED` en `errors.ts` con textos `es` y `en`; `restore` de gastos y transferencias
    lo lanza si el grupo cambió de moneda.
  - `members.ts` (`setCurrentMember`) y `accounts.ts` (`adoptLocalUser`) ya subían `version`: no se
    tocaron, quedan cubiertos por prueba. El `DELETE` físico del usuario local viejo no deja filas
    fantasma porque `users` no se sincroniza y nada del envío apunta a él.
  - Pruebas: `migration-0004` (`migrationsUpTo(4)` con datos de las Fases 1-3: conteos idénticos antes y
    después, contenido de las columnas viejas igual, `foreign_key_check` vacío), `sync-columns`
    (repositorios), y ajustes en `schema`, `migration-guard` y `accounts`. `npx jest src/db`: 17 suites,
    137 pruebas en verde; `npx tsc --noEmit` sin errores. No se corrió la suite completa.
- [x] 6. Banco de pruebas con PGlite y cliente remoto:
  - `src/test/supabase-pglite.ts`: `createSupabaseTestServer()` con `createUser`, `rpcFor`, `query` y
    `close`. **PGlite corre en un proceso hijo** (`src/test/pglite-worker.cjs`, IPC con serialización
    avanzada): carga su WASM con `import()` dinámico y Jest lo bloquea (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_
    MISSING_FLAG`) sin `--experimental-vm-modules`. Es el respaldo que preveía el plan, elegido por el
    usuario frente al flag, que habría cambiado cómo corre toda la suite. Aplica `plataforma.sql` y las
    migraciones del repo. Cada `rpcFor` corre una transacción como `authenticated` con su `sub`, y un
    error de Postgres se traduce como lo haría PostgREST (`22023` y `54000` → `protocol`, `42501` →
    `auth`, el resto → `server`). Fallas a propósito con `faults.failNext(modo, veces)`: `offline` y
    `server-error` no llegan a la base; `lost-response` aplica, confirma y luego lanza el error de red.
  - `src/db/sync/wire.ts`: tipos del contrato y esquemas zod de lo que devuelve el servidor
    (`sync_push`: lista de resultados; `sync_pull`: `has_more` pasa a `hasMore`). Las filas conservan sus
    columnas en snake_case y solo se exige `table` conocida e `id`; su forma por tabla se valida al
    aplicarlas (paso 8). `src/db/sync/remote.ts`: `createSyncRemote`, `SyncTransportError`, `RpcCall`.
    Una respuesta que no cumple el esquema, o que no trae exactamente un resultado por envío, es
    `protocol`; un error inesperado es `server`; `push([])` no llama al servidor. Los mensajes de error
    son fijos: nunca llevan lo enviado ni lo que contestó el servidor.
  - `src/lib/supabase/rpc.ts`: `createSupabaseRpc(client, { timeoutMs })` (30 s por omisión) con
    `AbortSignal`: sin red (estado 0) → `offline`, tiempo agotado → `timeout`, 401 y 403 → `auth`,
    408, 429 y 5xx → `server`, 400, 413 y el resto de 4xx → `protocol`.
  - Pruebas: `supabase-pglite` (11), `wire` (32), `remote` (14), `remote.int` contra las migraciones
    reales (6) y `rpc` (17); con las demás de `src/lib/supabase`, `npx jest src/test src/db/sync
    src/lib/supabase`: 8 suites y 110 pruebas en verde; `npx tsc --noEmit` sin errores. Sin suite
    completa. El servidor de prueba tarda unos 5 s en arrancar por archivo; por eso las pruebas que lo
    usan comparten uno en `beforeAll`.
- [x] 7. Motor, parte 1 (TDD): envío y borradores de conflicto. Solo envía; la descarga es del paso 8.
  - `src/db/sync/`: `units.ts` (unidad → `Mutation.data`, orden grupo → miembro → categoría → gasto →
    transferencia; el gasto lleva solo pagadores y partes activos, borrado va con listas vacías; las
    predefinidas nunca), `outbox.ts` (lotes y respuestas), `conflicts.ts` (borradores),
    `apply.ts` (valida con zod las filas del servidor y reemplaza la unidad local por la del
    servidor), `instant.ts` (`timestamptz` de Postgres a milisegundos, con la fracción llevada a 3
    dígitos por si Hermes no acepta más), `store.ts` (`SyncStore`), `types.ts` e `index.ts`.
    `src/features/sync/`: `cycle.ts` (`runSyncCycle`, solo envío, con `onNotice` y tope de lotes) y
    `test-utils.ts` (`createDevice`, `serverSnapshot`).
  - **Decisiones:**
    - Sin columnas nuevas: «aplicado» deja la unidad al día solo si su contenido actual es igual al
      enviado (si no, hubo cambios en vuelo: guarda `server_version` y sigue pendiente).
    - «Rechazado»: la unidad vuelve al estado del servidor con `version` local + 1 (un formulario
      abierto da `CONFLICT`) y el borrador guarda lo **último** que tenía el usuario, que incluye lo
      enviado aunque siguiera editando mientras el envío estaba en vuelo.
    - Sin estado del servidor (`current` vacío) y unidad nueva: solo un gasto o una transferencia
      salen de los movimientos (borrado lógico local, al día) y queda el borrador completo.
    - Si no se puede aplicar lo del servidor (por ejemplo, falta localmente un miembro que aún no
      se descarga) o es otra entidad sin `current`: el envío queda **apartado** (`failed`, motivo
      `error`), sin borrador y con lo del usuario intacto. Tras la descarga del paso 8,
      `retryFailed` lo vuelve a armar y entonces sí da el rechazo normal.
    - `retryFailed` borra los envíos apartados; la unidad sigue pendiente y se arma de nuevo con id
      nuevo. `counts().pending` no cuenta los apartados.
    - `SyncStore` trae también `listConflicts`, `getConflict` y `discardConflict` (los usarán las
      pantallas del paso 11). `cursors` y `applyRemoteGroup` se suman en el paso 8.
  - **Casos con el servidor de prueba** (`push.int.test.ts`, PGlite con las migraciones reales):
    sin red (`offline`, no llega a la base y al volver sube una sola vez, una entrada de historial
    por unidad), `server-error` en el segundo lote (el primero queda confirmado, el segundo sale
    otra vez con los mismos ids), `lost-response` (reintento sin duplicar filas, versiones ni
    historial), subida inicial con un grupo sin «yo» y un miembro quitado que sigue en un gasto, y
    conflictos de versión (editado en los dos, editar algo borrado, borrar algo editado, gasto nuevo
    con la moneda del grupo cambiada, mismo cambio en los dos): el servidor no se pisa y lo del
    usuario queda en el borrador. El «otro dispositivo» es un `push` directo con la misma cuenta;
    con la descarga del paso 8 pasa a ser un dispositivo completo.
  - **Paginación de pull:** este ciclo no descarga, así que aquí solo hay una prueba de lectura
    (`remote.pull` con `maxRows` 100 sobre 3 grupos: las páginas encadenan por `hasMore`, ningún
    grupo se parte y juntas traen todo). Aplicar páginas con `pullMaxRows` chico es del paso 8.
  - **Verificación:** `npx jest src/db/sync src/test src/features/sync`: 10 suites y 136 pruebas en
    verde; `npx tsc --noEmit` y `eslint` de las carpetas tocadas sin errores. Sin suite completa.
    4 mutaciones detectadas (sin marcar al día, sin borrador, ids nuevos en vuelo, base siempre
    nula).
- [x] 8. Motor, parte 2 (TDD): descarga y conflictos entre dos dispositivos.
  - `src/db/sync/pull.ts` (nuevo): `applyGroupChanges` (una unidad por punto de guardado),
    `readCursors` y `writeCursor` (nunca retrocede). `apply.ts`: `insertUnitFromServer`,
    `parseRemoteRowsLenient` (valida fila por fila con zod; una inválida se descarta y se cuenta) y
    fechas y `created_by` opcionales en los esquemas. `SyncStore`: `cursors()` y
    `applyRemoteGroup(changes): ApplyOutcome`. `runSyncCycle` envía y después descarga páginas
    (`pullMaxRows` 2000, `maxPages` 50); el resultado suma `pages`, `pulled`, `skipped` y `held`.
  - **Decisiones:**
    - `applied` y `skipped` cuentan **unidades** (grupo, miembro, categoría, gasto con sus pagadores y
      partes, transferencia), no filas.
    - Las FK **no se difieren** (`defer_foreign_keys` del diseño): con la base en `foreign_keys = ON` y
      el orden por tabla, una fila sin padre falla en el momento, deshace solo su unidad y deja el
      grupo `held`. Diferirlas habría hecho fallar todo el grupo al confirmar. Depende de que
      `foreign_keys` siga activo (lo ponen `client.ts` y las pruebas).
    - `held` (fila inválida, de otro grupo, hija de un gasto que no llegó, padre que falta o
      restricción): las unidades buenas se aplican y el cursor no avanza; al reintentar son iguales y
      no duplican. Una fila inválida que el servidor nunca corrige deja el grupo retenido para
      siempre: el paso 9 lo mostrará como estado «error».
    - Unidad con cambios locales: se salta y el cursor **sí** avanza; el envío sale con la base vieja
      y el servidor lo rechaza con `current` y borrador.
    - Eco o lote repetido: si la versión del servidor no supera `server_version`, no se hace nada; si
      la supera con el mismo contenido (borrado y archivado cuentan como sí o no, no como instante),
      solo se anota `server_version`, sin subir `version`.
    - Dentro de un ciclo, un grupo retenido se pide desde el cursor que llegó (en memoria) para no
      atascar a los demás; el cursor guardado no cambia y el próximo ciclo lo reintenta.
    - Un gasto o transferencia nuevo rechazado queda en el dispositivo como borrado lógico que el
      servidor nunca tuvo (decisión del paso 7); la prueba lo tiene en cuenta.
    - Las categorías predefinidas (sin grupo) no se descargan.
  - **Pruebas:** `pull.test.ts` (sql.js), `cycle.test.ts` (descarga) y `conflicts.int.test.ts` (12,
    dos dispositivos completos con PGlite: descarga, incremental, páginas, otra cuenta, y los
    conflictos de edición doble, editar lo borrado, borrar lo editado, renombrar grupo, moneda
    cambiada, «soy yo», mismo cambio y grupo archivado). Los cinco conflictos del paso 7 salen de
    `push.int.test.ts`: ahora el «otro dispositivo» es un `Device` con envío y descarga.
  - **Verificación:** `npx jest src/db/sync src/test src/features/sync`: 12 suites y 172 pruebas en
    verde; `npx tsc --noEmit`, eslint y prettier de las carpetas tocadas sin errores. Sin suite
    completa. 8 mutaciones detectadas (cursor fuera de la transacción, sin saltar pendientes, el eco
    sube `version`, sin orden por tabla, fila inválida sin retener, cursor que retrocede, grupo
    retenido que se vuelve a pedir, miembros sin liberar primero).
- [x] 9. Motor, parte 3 (TDD): cuándo sincronizar y estado.
  - `src/features/sync/engine.ts` (`createSyncEngine`), `status.ts` (puras: `deriveStatus`,
    `nextBackoff`, `sameStatus`), `network.ts` (`expo-network` 57.0.2, instalado con
    `npx expo install`) e `index.ts`. Reloj, red, `ensureProfile` y `random` se inyectan.
  - **Decisiones:**
    - Disparadores inmediatos: `open` (cuando se conoce la red; si leerla falla se supone que hay),
      `foreground`, `reconnect` y `manual`. `local-change`: 2 s tras la última escritura y como mucho
      10 s desde la primera; los cambios con `source: 'sync'` no la disparan. Un inmediato cancela la
      espera.
    - Un ciclo a la vez: un pedido durante un ciclo deja exactamente uno más. Si el ciclo falló, ese
      pedido espera al reintento. `syncNow` espera el ciclo en curso y el siguiente; `stop` lo suelta.
    - Sin red: cero llamadas, estado `offline`. Reintentos 5 s, 15 s, 45 s, 2 min y 5 min (±20 %)
      solo para `server`, `timeout` y `offline`; `protocol` y `auth` no se reintentan solos (estado
      `error`). Una escritura local durante la espera del reintento no la salta; un pedido del
      usuario sí.
    - Perfil remoto: se asegura una vez por sesión del motor; si no se pudo (o lanza), el ciclo solo
      descarga (`nextBatch` vacío) y se reintenta con el mismo backoff.
    - `SyncStatus` suma `held` (grupos retenidos por fila inválida) y `lastError` a lo del plan. Estado:
      `offline` > `error` (apartados, retenidos, `protocol`, `auth`) > `pending` (por subir o con
      reintento en camino) > `synced`. Los borradores por revisar no cambian el estado: se cuentan.
      `getStatus` devuelve el mismo objeto mientras nada cambie (apto para `useSyncExternalStore`) y se
      refresca con cada cambio del bus, no solo al terminar el ciclo.
    - `start` llama a `retryFailed` del almacén (apartados vuelven a la cola al abrir);
      `retryFailed()` del motor lo hace y pide un ciclo, que también reintenta los grupos retenidos.
    - Sin JSX ni textos: el indicador, la hoja y los textos `es`/`en` son del paso 10.
  - **Verificación:** `npx jest src/features/sync src/db/sync`: 14 suites y 220 pruebas en verde (59 nuevas:
    `status`, `network`, `engine`); `npx tsc --noEmit` y eslint de `src/features/sync` sin errores.
    Sin suite completa. 5 mutaciones detectadas (origen `sync`, ciclo repetido, espera del reintento,
    lectura de red fallida y envío sin perfil).
- [x] 10. Pantallas: indicador y hoja de estado (parte del paso 10 del plan).
  - `SyncProvider` (dentro de `DatabaseGate` en `app/(app)/_layout.tsx`, así que solo hay motor con
    sesión y base abierta): crea el motor con la base y el bus de la cuenta, lo arranca, pide un ciclo
    al volver la app al primer plano y lo detiene al desmontarse (cerrar sesión). `SyncEngineProvider`
    entrega un motor ya hecho (pruebas); `useSyncStatus` usa `useSyncExternalStore`. El motor real se
    arma en `app-engine.ts` (Supabase, red del sistema, reloj real).
  - `DatabaseContextValue` suma `bus` (el mismo de los repositorios). `AuthService.ensureProfile`
    devuelve `'synced' | 'pending'` y el efecto del layout pasó al motor.
  - `SyncStatusButton` (en el encabezado de Grupos): un ícono por estado (al día, por subir, sin
    conexión, atención y sincronizando) con nombre accesible y pista. `SyncStatusSheet`: frase de
    estado, filas solo con cuenta > 0 (por subir, por revisar, apartados, grupos retenidos) cada una
    con una explicación simple, último error traducido, última sincronización con `Intl`
    (`formatInstant`), "Sincronizar ahora" y "Reintentar" (con apartados, retenidos o un fallo).
  - Textos `sync.*` en `es` y `en`; solo tokens y componentes de `src/ui`.
  - **Pruebas:** `SyncStatusButton`, `SyncStatusSheet` y `SyncProvider` (motor falso en
    `fake-engine.ts`). `jest.setup.ts` simula `app-engine` en todas las pruebas de pantallas con un
    motor falso que asegura el perfil al arrancar; `renderWithDatabase` envuelve con uno.
    `npx jest` de `src/features/{sync/__tests__/Sync*,account,auth,navigation,__tests__}`, `src/i18n`
    y las de `DatabaseProvider`: en verde; `npx tsc --noEmit` y eslint/prettier de lo tocado sin
    errores. Sin suite completa.
- [x] 10b. Lo que quedó del paso 10 (cuatro commits):
  - **Prueba de flujo** (`flujo-sincronizacion.test.tsx`, PGlite + motor REAL por
    `SyncProvider.createEngine`): sin red → "sin conexión" y "por subir" → vuelve la red → "al día" y el
    servidor igual al teléfono; y un conflicto con otra tableta que deja un borrador (hoja: "1 cambio por
    revisar") y el Toast. Pasó de entrada porque el motor ya existía: se comprobó con mutaciones (sin
    disparo `reconnect` —con esperas largas en la prueba para que solo ese disparo pueda explicarlo— y sin
    aplicar las respuestas del envío); ambas la ponen en rojo. El rojo real fue el Toast (`SyncNotices`).
  - **Sincronizar primero:** `unsyncedCount` (por subir + apartados + borradores; `held` y `lastError` no
    cuentan) y `UnsyncedWarning` (cuentas, consecuencia, error traducido y "Sincronizar primero"; se
    redibuja con el estado del motor y desaparece solo si todo sube). `SignOutSheet`: la confirmación de
    borrar los datos del teléfono, con algo sin subir, ofrece sincronizar, "Borrar de todos modos" y
    cancelar; sin nada, `confirmBody` nuevo ("están en la nube"). `DeleteAccountScreen`: el mismo aviso
    sobre el botón de borrar. **Cerrar sesión conservando los datos no cambia** (quedan cifrados y suben al
    volver a entrar).
  - **Avisos:** `SyncNotices` (montado en `app/(app)/_layout.tsx`, por encima del aviso de "Deshacer"):
    un texto por razón (cambió, se borró, tu borrado no se aplicó, moneda del grupo cambiada, moneda
    bloqueada); varios juntos se resumen en uno. Se queda hasta cerrarlo o tocar "Revisar", que lleva al
    detalle del grupo (`/groups/<id>`) sin pantalla nueva. `fake-engine` suma `emitNotice`.
  - **Reiniciar los datos de este teléfono:** `DatabaseGate` recibe `onReset` (el layout pasa
    `deleteAccountData(userId)`); la pantalla de error pide dos confirmaciones, borra y vuelve a abrir una
    base vacía, que el motor repone con la descarga completa. Si el borrado falla, lo dice y deja
    reintentar. Con esto sale de CLAUDE.md el pendiente "Clave de cifrado perdida" **en el paso 12**.
  - **Verificación:** `npx jest` de `src/features/{sync,account,navigation}`, `src/db` e `src/i18n`
    (todo en verde); `npx tsc --noEmit`, eslint y prettier de lo tocado sin errores. Sin suite completa.
- [ ] 11. Pantallas: borradores por revisar.
- [ ] 12. Cierre: verificaciones, revisión de seguridad, CLAUDE.md, PR, builds y prueba en el
      teléfono.

## Notas para retomar

- Rama `fase-4a-sincronizacion`, creada desde `main` en `5217e74` (merge del PR #4).
- expo-doctor marcó 6 parches el 2026-10-14 (lista en el paso 1 de `plan.md`).
- PGlite: 0.5.8 (del 2026-08-26, el mismo de la Fase 3). La 0.5.9 salió el 2026-10-12 y no se usa
  todavía. `@electric-sql/pglite` trae build CommonJS (`require`), así que puede cargarse en Jest.
- `expo-network` 57.0.2 es la versión del SDK 57 (del 2026-09-11).
- El remoto tiene 2 perfiles y 0 grupos: los rellenos de las migraciones no tocan datos reales.
- El formulario de movimientos ya tiene `valuesFromExpense` y `valuesFromTransfer`: el paso 11 los
  usa para abrir un borrador.
- La app acepta montos hasta `Number.MAX_SAFE_INTEGER` y el servidor hasta 99 999 999 999 999: el
  paso 5 alinea la app con el servidor.
- `eas env:list` oculta los valores sensibles (`***** (...)`): para comparar con `.env` sin
  mostrarlos, `--include-sensitive` y la comparación dentro del mismo comando.
- Para el paso 8: las filas del servidor traen `created_by` y `user_id` de la cuenta; localmente son
  el id del usuario local (que ya es el id de la cuenta). Un grupo nuevo que llega del servidor
  necesita ese usuario en `users`. `apply.ts` ya valida las filas por tabla (`parseRemoteRows`) y
  reconcilia pagadores y partes (`replaceUnitFromServer`); el paso 8 suma `applyRemoteGroup` con
  FKs diferidas (`PRAGMA defer_foreign_keys`), un punto de guardado por fila y el cursor.
- pgTAP en la PC: `npm run test:db:local` (unos 3 s) o `npm run test:db:local -- 007` para un
  archivo (000-setup corre siempre). El CI sigue siendo la fuente de verdad.
- En las pruebas, para preparar fechas o versiones viejas hay que apagar el trigger
  `<tabla>_sync_stamp` como `postgres` (`alter table ... disable trigger`), porque el trigger
  también corre para `postgres`.
- `has_column_privilege` sobre una columna que no está en todas las tablas va dentro de un `CASE`:
  el orden del `WHERE` no está fijo (pasó con `deleted_at` y `auth.users`).
- `EXECUTE` para `PUBLIC` en funciones nuevas no se quita por esquema: cada función lo revoca.
- `supabase test db` corre como prueba todo `.sql` bajo `supabase/tests`: los archivos de apoyo
  van fuera (`supabase/pglite/plataforma.sql`). El primer CI del paso 2 (run 38544389269) falló por
  eso, con las 178 pruebas pgTAP en verde sobre Postgres 17.
