# Fase 4a — Progreso

> Se actualiza con el commit de cada paso. Si una sesión se corta, se retoma desde
> "Siguiente paso". Tareas en `plan.md`; decisiones en `diseno.md`. El usuario pide detenerse cada
> 2 pasos.

**Siguiente paso:** 6, banco de pruebas con PGlite y cliente remoto.

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
- [ ] 6. Banco de pruebas con PGlite y cliente remoto.
- [ ] 7. Motor, parte 1 (TDD): envío y borradores de conflicto.
- [ ] 8. Motor, parte 2 (TDD): descarga y conflictos entre dos dispositivos.
- [ ] 9. Motor, parte 3 (TDD): cuándo sincronizar y estado.
- [ ] 10. Pantallas: indicador, avisos, sesión y reinicio de la base.
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
