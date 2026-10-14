# Fase 4a — Plan de implementación: sincronización con Supabase

> **Ejecución:** en la misma sesión, paso por paso, con un commit por paso y `progreso.md` en el
> mismo commit. El usuario pide detenerse cada 2 pasos. TDD en el motor de sincronización
> (skill test-driven-development) y pgTAP antes de cada migración. Antes de cerrar, la skill
> verification-before-completion. Los pasos usan casillas `- [ ]`.

**Objetivo:** que los datos de cada cuenta vivan en Supabase y se sincronicen entre dispositivos sin
perder el funcionamiento offline-first. Diseño en `design/fase-4a/diseno.md`.

**Arquitectura:**

- `supabase/migrations`: columnas que pone el servidor, contador de cambios por grupo, guardia de
  escritura, reglas, RLS con acceso del creador y las RPC `sync_push` y `sync_pull`.
- `src/db/sync/`: todo lo que toca SQLite (filas pendientes, envíos, aplicar datos del servidor,
  cursores) detrás de `SyncStore`, más el contrato de red validado con zod.
- `src/features/sync/`: el ciclo, el motor (cuándo sincronizar y el estado), el proveedor y la UI.
- `src/lib/supabase/rpc.ts`: llamadas a las RPC con supabase-js y tiempo límite.

**Stack nuevo:**

- `expo-network` (módulo del SDK 57, con `npx expo install`);
- `@electric-sql/pglite` 0.5.8 y `@electric-sql/pglite-pgtap` 0.0.9 como dependencias de desarrollo
  (Postgres en WASM para Jest y para correr pgTAP en la PC sin Docker).

## Restricciones globales

- Toda la comunicación, los planes, los PR y los commits van en español. Los identificadores siguen
  las convenciones del repo; los comentarios del código, en español.
- Commit al terminar cada paso con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, y
  `progreso.md` al día en ese mismo commit.
- Toda migración que crea una tabla, función o secuencia en `public` trae en el mismo archivo sus
  GRANT explícitos (nunca a `anon`), RLS y políticas, y actualiza `001-estructura` y
  `006-privilegios`. Los privilegios cambian solo por migraciones.
- Antes de `supabase db push`, pedir permiso. Después, `npm run check:data-api` debe pasar. La
  contraseña de `prueba1@splitmate.test` solo va en la variable de entorno de un comando.
- Nunca la clave secreta ni `service_role` en el repo o en la app.
- Todo dato que llega de la red se valida con zod.
- `app/`, `src/features/` y `src/ui/` no importan SQL, Drizzle ni el esquema.
- Cero textos fijos en JSX (i18n `es` y `en`), áreas táctiles de 44 px y contraste AA.
- Los registros nunca llevan montos, nombres, correos ni tokens.
- Versiones fijas: Supabase CLI 2.120.0, `eas-cli` 24.12.1 (`npx -y eas-cli@24.12.1`), PGlite 0.5.8.
- Ante EPERM, EBUSY o archivos bloqueados en npm o Gradle (OneDrive): detenerse y avisar.

## Mapa de archivos

| Archivo                                                                | Responsabilidad                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `eas.json`                                                             | Perfil `preview` con `environment: preview`                              |
| `supabase/migrations/*_sincronizacion_base.sql`                        | Columnas del servidor, `change_seq`, guardia, reglas, RLS, privilegios   |
| `supabase/migrations/*_sincronizacion_rpc.sql`                         | `sync_mutations`, `sync_push`, `sync_pull` y funciones de apoyo          |
| `supabase/migrations/*_borrar_cuenta_grupos.sql`                       | Borrar la cuenta borra sus grupos no compartidos                         |
| `supabase/tests/database/007` a `010`                                  | pgTAP de columnas, envío, descarga y borrado de cuenta                   |
| `supabase/tests/pglite/plataforma.sql`                                 | Lo mínimo de Supabase para PGlite: roles, `auth.users`, `auth.uid()`     |
| `scripts/test-db-local.mjs`                                            | `npm run test:db:local`: migraciones y pgTAP en PGlite, sin Docker       |
| `scripts/check-data-api.mjs`                                           | Suma las comprobaciones de las RPC y de la guardia                       |
| `src/db/schema.ts` y `src/db/migrations/0004_*`                        | `server_version`, `synced_version`, `group_currency`, tablas de sync     |
| `src/db/sync/wire.ts`                                                  | Contrato de red: tipos y esquemas zod                                    |
| `src/db/sync/units.ts`                                                 | Unidades (grupo, miembro, categoría, gasto, transferencia) y columnas    |
| `src/db/sync/outbox.ts`                                                | Lotes de envío y aplicar respuestas                                      |
| `src/db/sync/apply.ts`                                                 | Aplicar filas del servidor en una transacción por grupo                  |
| `src/db/sync/remote.ts`                                                | `SyncRemote` sobre una llamada RPC inyectada                             |
| `src/db/sync/store.ts`                                                 | `SyncStore`: la API que usa el motor                                     |
| `src/lib/supabase/rpc.ts`                                              | RPC con supabase-js, tiempo límite y errores clasificados                |
| `src/test/supabase-pglite.ts`                                          | Servidor de prueba: PGlite con las migraciones y fallas a propósito      |
| `src/features/sync/cycle.ts`                                           | Un ciclo: perfil, envío por lotes y descarga por páginas                 |
| `src/features/sync/engine.ts`                                          | Cuándo sincronizar, un ciclo a la vez, reintentos y estado               |
| `src/features/sync/network.ts`                                         | Adaptador de `expo-network`                                              |
| `src/features/sync/SyncProvider.tsx`                                   | Crea el motor por cuenta, `AppState`, red y contexto                     |
| `src/features/sync/{SyncStatusButton,SyncStatusSheet,SyncNotices}.tsx` | Indicador, hoja de estado y avisos                                       |
| `src/features/sync/test-utils.ts`                                      | Dispositivos simulados para las pruebas                                  |
| `app/(app)/_layout.tsx`                                                | Monta `SyncProvider`; el perfil remoto pasa al ciclo                     |
| `src/db/DatabaseProvider.tsx`                                          | Bus y `SyncStore` en el contexto; "Reiniciar los datos de este teléfono" |

## Contratos compartidos

Los nombres de este bloque se usan igual en todas las tareas.

```ts
// src/db/sync/wire.ts
export type SyncEntity = 'group' | 'member' | 'category' | 'expense' | 'transfer';
export type SyncTable =
  | 'groups'
  | 'group_members'
  | 'categories'
  | 'expenses'
  | 'expense_payers'
  | 'expense_splits'
  | 'transfers';
export interface Mutation {
  readonly id: string; // UUID del envío
  readonly entity: SyncEntity;
  readonly base: number | null; // versión del servidor; null si es nueva
  readonly data: Readonly<Record<string, unknown>>;
}
export interface RemoteRow {
  readonly table: SyncTable;
  readonly row: Readonly<Record<string, unknown>>;
}
export type RejectReason = 'deleted' | 'currency_locked' | 'group_currency_changed';
export type FailReason = 'forbidden' | 'invalid' | 'not_found' | 'error';
export type PushResult =
  | {
      readonly id: string;
      readonly status: 'applied';
      readonly version: number;
      readonly current: readonly RemoteRow[];
    }
  | {
      readonly id: string;
      readonly status: 'rejected';
      readonly reason: RejectReason;
      readonly current: readonly RemoteRow[];
    }
  | { readonly id: string; readonly status: 'failed'; readonly reason: FailReason };
export interface RemoteGroupChanges {
  readonly id: string;
  readonly cursor: number;
  readonly rows: readonly RemoteRow[];
}
export interface PullResponse {
  readonly groups: readonly RemoteGroupChanges[];
  readonly hasMore: boolean;
}

// src/db/sync/remote.ts
export type RpcName = 'sync_push' | 'sync_pull';
export type RpcCall = (name: RpcName, args: Readonly<Record<string, unknown>>) => Promise<unknown>;
export type TransportErrorKind = 'offline' | 'timeout' | 'server' | 'auth' | 'protocol';
export class SyncTransportError extends Error {
  readonly kind: TransportErrorKind;
}
export interface SyncRemote {
  push(mutations: readonly Mutation[]): Promise<PushResult[]>;
  pull(cursors: Readonly<Record<string, number>>, maxRows: number): Promise<PullResponse>;
}
export function createSyncRemote(rpc: RpcCall): SyncRemote;

// src/db/sync/store.ts
export interface SyncNotice {
  readonly reason: RejectReason;
  readonly entity: SyncEntity;
  readonly label: string; // nombre del grupo o miembro, título del movimiento
  readonly wasNew: boolean; // nunca llegó al servidor: se borró del teléfono
}
export interface ApplyOutcome {
  readonly applied: number;
  readonly skipped: number;
  readonly held: boolean;
}
export interface SyncStore {
  counts(): { readonly pending: number; readonly failed: number };
  nextBatch(limit: number): Mutation[];
  applyPushResults(results: readonly PushResult[]): SyncNotice[];
  cursors(): Record<string, number>;
  applyRemoteGroup(changes: RemoteGroupChanges): ApplyOutcome;
  retryFailed(): number;
}
export function createSyncStore(
  db: AppDatabase,
  bus: ChangeBus,
  deps: { now(): number; newMutationId(): string },
): SyncStore;

// src/features/sync/engine.ts
export type SyncTrigger = 'open' | 'foreground' | 'reconnect' | 'local-change' | 'manual';
export type SyncState = 'synced' | 'pending' | 'offline' | 'error';
export interface SyncStatus {
  readonly state: SyncState;
  readonly syncing: boolean;
  readonly pending: number;
  readonly failed: number;
  readonly lastSyncedAt: number | null;
}
export interface SyncEngine {
  start(): void;
  stop(): void;
  request(trigger: SyncTrigger): void;
  retryFailed(): void;
  getStatus(): SyncStatus;
  subscribe(listener: () => void): () => void;
  onNotice(listener: (notice: SyncNotice) => void): () => void;
}
```

## Tareas

### 1. Parches de Expo y perfil preview de EAS

**Archivos:** `package.json`, `package-lock.json`, `eas.json`, `design/fase-4a/progreso.md`.

- [ ] `npx expo install --fix`: expo 57.0.28, expo-crypto 57.0.4, expo-dev-client 57.0.20,
      expo-router 57.0.26, expo-splash-screen 57.0.10 y jest-expo 57.0.6.
- [ ] `npx expo-doctor` (21/21), `npx tsc --noEmit`, `npm run lint` y
      `npm test -- --watchAll=false`.
- [ ] `eas.json`: `"environment": "preview"` en el perfil `preview` (APK, distribución interna,
      credenciales de EAS por omisión).
- [ ] Variables `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` en el entorno
      `preview` de EAS, sensibles, leídas de `.env` dentro del comando sin imprimirlas. Revisar
      antes la sintaxis con `--help` (`env:create` está obsoleto). Comprobar con la salida enmascarada.
- [ ] Keystore: confirmar si EAS lo genera sin preguntas en el primer build de preview. Si pide
      interacción, anotar en `progreso.md` el comando que corre el usuario al cierre. Sin builds.
- [ ] Commit `chore: parches de Expo SDK 57 y perfil preview de EAS`.

### 2. Servidor: migración base

**Archivos:** `supabase/migrations/*_sincronizacion_base.sql`, `supabase/tests/database/000`,
`001`, `002`, `003`, `006` y `007-sync-columnas.test.sql` (nuevo),
`supabase/tests/pglite/plataforma.sql`, `scripts/test-db-local.mjs`, `package.json`.

**Produce (SQL):**

- `private.group_changes (group_id uuid primary key references public.groups on delete cascade
deferrable initially deferred, last_seq bigint not null)`, relleno con los grupos existentes.
- `private.next_change_seq(uuid) returns bigint` (`SECURITY DEFINER`).
- `private.can_access_group(uuid)` y `private.is_group_creator(uuid)` (`SECURITY DEFINER`,
  `STABLE`). Sale `private.can_bootstrap_group`.
- `change_seq bigint not null default 0` en las 7 tablas e índice `(group_id, change_seq)`.
- `group_currency text not null` con CHECK `^[A-Z]{3}$` en `expenses` y `transfers`.
- Triggers: `private.stamp_sync_row()` en las 7 tablas (guardia, `created_at`, `updated_at`,
  `version`, `deleted_at`, `change_seq`); `private.check_group_write()` (`archived_at` y moneda
  bloqueada `SMCUR`); `private.check_movement_currency()` (`SMGCC`);
  `private.check_member_link()` (`user_id` propio o nulo, `42501`).
- Políticas con `can_access_group`; `groups` compara su `created_by`; en `group_members`, `user_id`
  nulo o propio y `owner` solo para el creador.
- Privilegios: sin `UPDATE` de `updated_at` y `version`; con `UPDATE` de `group_members.user_id` y
  de `group_currency`; en pagadores y partes solo `deleted_at`; `service_role` sin privilegios en
  `public`; privilegios por omisión iguales al remoto.

- [ ] Banco local: `plataforma.sql` (roles `anon`, `authenticated` y `service_role`; esquema `auth`
      con `users` y `uid()` que lee `request.jwt.claims`; privilegios por omisión de Supabase en
      `public`; esquema `extensions`) y `scripts/test-db-local.mjs` (PGlite 0.5.8 con pgTAP 0.0.9:
      aplica `plataforma.sql`, las migraciones en orden y cada archivo de pruebas con
      `discard temp` entre archivos). Script `test:db:local` en `package.json`. Las 128 pruebas
      actuales en verde.
- [ ] `000-setup`: `crear_mundo` con `group_currency`; `tests.autenticar_como` pone la marca de
      `sync_push` y `tests.sin_marca_sync()` la quita.
- [ ] Pruebas primero en `007-sync-columnas` (fallan sin la migración):
  - insertar fija `created_at`, `updated_at` y `version = 1` aunque el cliente mande otros;
  - editar suma 1 a `version`, conserva `created_at` y renueva `updated_at`;
  - `deleted_at` y `archived_at` toman `now()` y conservan el instante si ya tenían;
  - `change_seq` crece por grupo y no depende de otros grupos; dos filas de una transacción
    tienen valores distintos y crecientes;
  - la cascada `SET NULL` de borrar una cuenta asigna `change_seq` nuevo;
  - sin la marca, `authenticated` no inserta ni edita en ninguna de las 7 tablas (`42501`); con la
    marca, sí; `postgres` siempre;
  - cambiar la moneda con un movimiento activo falla con `SMCUR`; con movimientos borrados, no;
  - un gasto o transferencia activo con `group_currency` distinta falla con `SMGCC`;
  - vincular o desvincular la cuenta de otro falla; la propia, sí;
  - el creador sin miembro vinculado lee y escribe su grupo; un ajeno, no;
  - `owner` lo inserta solo el creador.
- [ ] Ajustar `002`, `003` y `006` a las reglas nuevas (acceso del creador, columnas que ya no se
      editan, `user_id` editable con sus reglas, sin `can_bootstrap_group`, matriz de privilegios y
      `service_role` sin privilegios) y `001` (las funciones nuevas fijan `search_path`).
- [ ] Migración. `npm run test:db:local` en verde.
- [ ] Push de la rama y CI verde en "Base de datos y RLS" (la fuente de verdad: Postgres 17).
- [ ] Commit `feat(supabase): columnas del servidor, cambios por grupo y guardia de escritura`.

### 3. Servidor: `sync_push` y `sync_pull`

**Archivos:** `supabase/migrations/*_sincronizacion_rpc.sql`,
`supabase/tests/database/008-sync-push.test.sql`, `009-sync-pull.test.sql`, `001` y `006`.

**Produce (SQL):**

- `private.sync_mutations (user_id uuid references auth.users on delete cascade, mutation_id uuid,
entity text, entity_id uuid, version integer, applied_at timestamptz default now(),
primary key (user_id, mutation_id))`.
- `public.sync_push(p_mutations jsonb) returns jsonb` (`SECURITY INVOKER`, `VOLATILE`).
- `public.sync_pull(p_cursors jsonb, p_max_rows integer default 2000) returns jsonb`
  (`SECURITY INVOKER`, `STABLE`).
- Apoyo en `private`: `sync_find_mutation(uuid) returns integer` y
  `sync_remember_mutation(uuid, text, uuid, integer)` (`SECURITY DEFINER`, solo filas de
  `auth.uid()`); `lock_group_changes(uuid)` (`SECURITY DEFINER`); `sync_entity_rows(text, uuid)
returns jsonb`; `sync_apply_group`, `sync_apply_member`, `sync_apply_category`,
  `sync_apply_expense` y `sync_apply_transfer` (`(p_data jsonb, p_base integer) returns integer`,
  `SECURITY INVOKER`).
- Errores: `SMDEL` (borrado gana), `SMINV` (datos inválidos), `SMNFD` (versión de algo que no
  existe), más `SMCUR` y `SMGCC` del paso 2. Respuestas según `diseno.md`.

- [ ] Pruebas primero en `008-sync-push`:
  - alta de grupo, miembros, gasto con pagadores y partes, y transferencia en una llamada; `current`
    con el estado final;
  - el mismo envío otra vez: `applied` con la misma versión, sin filas nuevas ni `version` de más,
    aunque otro cambio haya llegado entre medio;
  - `base` vieja: gana el último (gasto completo, nunca mezclado);
  - editar algo borrado con `base` vieja: `rejected: deleted` con `current`; borrar con `base` vieja
    se aplica;
  - desarchivar, cambiar la moneda o "soy yo" con `base` vieja: se ignoran; archivar se aplica;
  - "soy yo" al día: el miembro que tenía tu cuenta queda sin cuenta;
  - moneda al día con movimientos: `rejected: currency_locked`;
  - movimiento con otra `group_currency`: `rejected: group_currency_changed` (`current` vacío si es
    nuevo);
  - sumas que no cuadran, tasa distinta de 1 en la moneda del grupo, miembro repetido, parte
    existente con otro monto, cambio de `group_id`: `failed: invalid`;
  - grupo ajeno: `failed: forbidden`; `base` de una fila inexistente: `failed: not_found`;
  - un envío inválido no frena a los demás de la misma llamada;
  - un cambio idéntico no sube `version` ni `change_seq`;
  - una lista vacía devuelve `[]`; 51 envíos o un arreglo mal formado: error de la llamada; `anon`
    no la ejecuta.
- [ ] Pruebas primero en `009-sync-pull`:
  - sin cursores trae cada grupo con acceso completo, borrados incluidos, y el `cursor` más alto;
  - con cursor trae solo lo posterior; sin cambios, nada;
  - grupos completos hasta `p_max_rows` y `has_more`; un grupo más grande que el límite sale solo;
  - un usuario no ve grupos de otro; `anon` no la ejecuta.
- [ ] Migración. `npm run test:db:local` en verde; push y CI verde.
- [ ] Commit `feat(supabase): RPC sync_push y sync_pull`.

### 4. Servidor: borrar la cuenta borra sus grupos, y `check:data-api`

**Archivos:** `supabase/migrations/*_borrar_cuenta_grupos.sql`,
`supabase/tests/database/010-borrar-cuenta.test.sql`, `scripts/check-data-api.mjs`.

- [ ] Pruebas primero en `010`: al borrar la cuenta de Ana se borran "Oficina" (Ana y Yago, sin otra
      cuenta) con todas sus filas, y queda "Viaje" (Beto tiene cuenta), con el miembro de Ana sin
      cuenta; sus envíos de `sync_mutations` también se borran.
- [ ] Migración: `private.delete_unshared_groups()` (`SECURITY DEFINER`) en un trigger
      `BEFORE DELETE` de `profiles`.
- [ ] `check:data-api`: `anon` no ejecuta las RPC; `authenticated` ejecuta `sync_pull` (sin grupos)
      y `sync_push([])`; un `POST` directo a `groups` con nombre vacío da `42501` (y no `23514`).
- [ ] `npm run test:db:local`, push y CI verde.
- [ ] Commit `feat(supabase): borrar la cuenta borra sus grupos no compartidos`.

**Punto de control:** pedir permiso para `supabase db push` de las tres migraciones
(`db push --dry-run` primero). Después, `npm run check:data-api` contra el remoto.

### 5. Base local: columnas y tablas de sincronización

**Archivos:** `src/db/schema.ts`, `src/db/migrations/0004_*.sql` y su `meta`, `migrations.js`,
`src/db/repositories/{expenses,transfers,errors}.ts`, `src/i18n/locales/{es,en}.json` y pruebas en
`src/db/__tests__/`.

**Produce:** en el esquema, `serverVersion` y `syncedVersion` en las 7 tablas sincronizables
(`users` no cambia), `groupCurrency` en `expenses` y `transfers`, `syncOutbox` y `syncCursors`, e
índices parciales de pendientes; el error de repositorio `CURRENCY_CHANGED`.

- [ ] Pruebas primero:
  - `migration-0004.test.ts`: una base con datos de las Fases 1 a 3 migra con `group_currency` de
    su grupo, las 9 predefinidas sincronizadas y todo lo demás pendiente;
  - repositorios: registrar y editar guardan `groupCurrency`; restaurar un movimiento cuya moneda de
    grupo cambió falla con `CURRENCY_CHANGED`; toda escritura deja la unidad pendiente
    (`synced_version` distinta de `version`).
- [ ] `schema.ts` y `npx drizzle-kit generate --name sincronizacion`. A mano en el `.sql`: el CHECK
      de `group_currency` como restricción de columna (así no se reconstruye la tabla) y los
      `UPDATE` de relleno. `assertMigrationsHaveSql` cubre la migración nueva.
- [ ] Repositorios y textos `es` y `en` de `CURRENCY_CHANGED`.
- [ ] Commit `feat(db): columnas y tablas de sincronización en la base local`.

### 6. Banco de pruebas con PGlite y cliente remoto

**Archivos:** `src/test/supabase-pglite.ts`, `src/db/sync/{wire,remote}.ts`,
`src/lib/supabase/rpc.ts` y sus pruebas.

**Produce:**

```ts
// src/test/supabase-pglite.ts (solo Jest, entorno node)
export interface FaultPlan {
  failNext(mode: 'offline' | 'lost-response' | 'server-error', times?: number): void;
}
export interface SupabaseTestServer {
  createUser(name: string): Promise<string>; // auth.users y su perfil
  rpcFor(userId: string): RpcCall & { readonly faults: FaultPlan };
  query<T>(sql: string, params?: unknown[]): Promise<T[]>; // como postgres
  close(): Promise<void>;
}
export function createSupabaseTestServer(): Promise<SupabaseTestServer>;
// src/lib/supabase/rpc.ts
export function createSupabaseRpc(
  client: SupabaseClient,
  options?: { timeoutMs?: number },
): RpcCall;
```

- [ ] Pruebas primero:
  - el servidor de prueba aplica las migraciones; `rpcFor` corre como `authenticated` con su `sub`;
  - `lost-response` aplica en la base y lanza error de red; `offline` no llega a la base;
  - `createSyncRemote` rechaza con `protocol` respuestas que no cumplen el esquema zod y clasifica
    los errores;
  - `createSupabaseRpc` (con un `fetch` falso): sin red → `offline`, tiempo agotado → `timeout`,
    5xx → `server`, 401 → `auth`, 400 → `protocol`.
- [ ] Implementación. Si PGlite no carga en el entorno de Jest, cargarlo en un proceso hijo con el
      mismo contrato `RpcCall`.
- [ ] Commit `test(sync): servidor de prueba con PGlite y cliente remoto validado`.

### 7. Motor, parte 1 (TDD): envío

**Archivos:** `src/db/sync/{units,outbox,apply,store,index}.ts`, `src/features/sync/{cycle,test-utils}.ts`
y pruebas.

**Produce:** `createSyncStore` con `counts`, `nextBatch`, `applyPushResults` y `retryFailed`;
`runSyncCycle({ store, remote, batchSize = 50, pullMaxRows = 2000 })` (en este paso solo envía);
`createDevice(server, userId)` en `test-utils.ts`: base sql.js, repositorios, `SyncStore`,
`sync()` y `snapshot()` comparable entre dispositivos.

- [ ] Pruebas de unidad primero (`outbox.test.ts`, sql.js):
  - orden por grupo y dependencias; el gasto lleva solo sus pagadores y partes activos;
  - el lote queda guardado antes de devolverse; un envío sin respuesta se repite con el mismo id y
    contenido;
  - `applied` sin cambios en vuelo: aplica `current` y la unidad queda al día; con cambios en vuelo:
    guarda `server_version` y sigue pendiente;
  - `rejected`: aplica `current`; con `current` vacío borra la unidad local y avisa `wasNew`;
  - `failed`: queda apartada, fuera de los lotes; `retryFailed` la devuelve;
  - las predefinidas nunca se envían.
- [ ] Pruebas con dos dispositivos y PGlite primero (`push.int.test.ts`):
  - el teléfono crea grupo, miembros y gastos; el servidor queda igual a la base local;
  - respuesta perdida después del commit: el reintento no duplica ni sube versiones;
  - sin red antes de enviar: nada llega; al volver, todo una sola vez;
  - error del servidor en el segundo lote: el primero queda confirmado y el segundo se repite;
  - subida inicial de datos viejos, con un grupo sin "yo" y un miembro quitado que sigue en un gasto.
- [ ] Implementación hasta verde.
- [ ] Commit `feat(sync): cola de envío idempotente`.

### 8. Motor, parte 2 (TDD): descarga y conflictos

**Archivos:** `src/db/sync/{apply,store}.ts`, `src/features/sync/cycle.ts` y pruebas.

**Produce:** `SyncStore.applyRemoteGroup` y `cursors`; `runSyncCycle` completo (envía y después
descarga páginas hasta `hasMore: false`, con un tope de páginas por ciclo).

- [ ] Pruebas de unidad primero (`apply.test.ts`, sql.js):
  - un grupo nuevo del servidor se inserta completo y avanza el cursor;
  - el eco de lo propio solo actualiza `server_version` y fechas, sin subir `version`;
  - contenido distinto reemplaza la fila y sube `version` (un formulario abierto da `CONFLICT`);
  - salta las unidades pendientes sin frenar el cursor;
  - "soy yo" movido y una parte reemplazada se aplican sin chocar con los índices únicos;
  - un hijo antes que su padre en la lista se aplica (FKs diferidas);
  - una fila que falla deshace solo su punto de guardado y no avanza el cursor;
  - un solo aviso en el bus por grupo, con `source: 'sync'`.
- [ ] Pruebas con dos dispositivos y PGlite primero (`conflicts.int.test.ts`):
  - la tablet descarga lo que creó el teléfono y los dos quedan iguales;
  - el mismo gasto editado en ambos sin conexión: gana el último en sincronizar, completo;
  - editar algo borrado en el otro: aviso `deleted`, queda borrado en ambos;
  - borrar algo editado en el otro: queda borrado en ambos;
  - renombrar un grupo archivado en el otro: archivado con el nombre nuevo;
  - gasto nuevo sin conexión y moneda cambiada en el otro: se borra del teléfono con aviso;
  - "soy yo" cambiado en los dos: gana el último con la versión al día;
  - una segunda cuenta no recibe nada de la primera;
  - descarga en varias páginas con `pullMaxRows` chico.
- [ ] Implementación hasta verde.
- [ ] Commit `feat(sync): descarga por grupos y resolución de conflictos`.

### 9. Motor, parte 3 (TDD): cuándo sincronizar y estado

**Archivos:** `src/features/sync/{engine,network}.ts`, `package.json` (`npx expo install
expo-network`) y pruebas.

**Produce:**

```ts
export interface NetworkMonitor {
  current(): Promise<boolean>; // hay internet
  subscribe(listener: (online: boolean) => void): () => void;
}
export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export function createSyncEngine(deps: {
  store: SyncStore;
  remote: SyncRemote;
  changes: { subscribe(listener: (change: DataChange) => void): () => void };
  network: NetworkMonitor;
  ensureProfile(): Promise<'synced' | 'pending'>;
  scheduler: Scheduler;
  random(): number;
  options?: { debounceMs?: number; maxWaitMs?: number; batchSize?: number; pullMaxRows?: number };
}): SyncEngine;
```

- [ ] Pruebas primero (`engine.test.ts`, `SyncStore` y `SyncRemote` falsos, `Scheduler` manual):
  - cinco escrituras locales seguidas producen un solo ciclo 2 s después de la última, y como mucho
    10 s después de la primera; los cambios con `source: 'sync'` no disparan nada;
  - `open`, `foreground`, `reconnect` y `manual` sincronizan de inmediato;
  - un pedido durante un ciclo produce exactamente un ciclo más;
  - sin red: estado `offline`, sin llamadas; al reconectar, un ciclo;
  - error del servidor: reintentos a 5 s, 15 s, 45 s, 2 min y 5 min (±20 %); un éxito los reinicia;
  - `protocol` o envíos apartados: estado `error`;
  - `start` reintenta los apartados (al abrir la app) y `stop` cancela temporizadores y
    suscripciones;
  - el perfil remoto se asegura una vez por sesión del motor; si no se pudo, el ciclo descarga pero
    no envía, y lo vuelve a intentar en el siguiente;
  - estado con `pending`, `failed`, `syncing` y `lastSyncedAt`; los avisos del ciclo llegan a
    `onNotice`.
- [ ] `network.ts` con `Network.getNetworkStateAsync` y `addNetworkStateListener`
      (`isConnected` e `isInternetReachable`).
- [ ] Implementación hasta verde.
- [ ] Commit `feat(sync): motor con espera, reintentos y estado`.

### 10. Pantallas: indicador, avisos, sesión y reinicio de la base

**Archivos:** `src/features/sync/{SyncProvider,SyncStatusButton,SyncStatusSheet,SyncNotices,index}.tsx`,
`app/(app)/_layout.tsx`, `src/db/DatabaseProvider.tsx`, `src/features/groups/GroupsScreen.tsx`,
`src/features/account/{SignOutSheet,DeleteAccountScreen}.tsx`, `src/i18n/locales/{es,en}.json` y
pruebas.

- [ ] Pruebas primero (RNTL, con un motor falso):
  - el indicador muestra cada estado con su nombre accesible y abre la hoja;
  - la hoja muestra pendientes, apartados y la última sincronización; "Sincronizar ahora" y
    "Reintentar" llaman al motor;
  - un aviso de cada razón muestra su texto y se cierra;
  - cerrar sesión y borrar: el texto cambia con y sin pendientes;
  - la pantalla de error de la base ofrece reiniciar, pide confirmar y vuelve a abrir una base vacía.
- [ ] Prueba del flujo completo primero (`flujo-sincronizacion.test.tsx`, PGlite): crear un grupo y
      un gasto desde la UI, ver "pendiente" y después "sincronizado", y un segundo dispositivo los
      descarga iguales.
- [ ] `SyncProvider` en `(app)`: crea el motor con la base de la cuenta, `createSupabaseRpc`,
      `AppState` y la red; lo detiene al cerrar sesión. El efecto de `ensureProfile` sale del layout
      y `AuthService.ensureProfile` devuelve `'synced' | 'pending'` para el motor.
- [ ] `DatabaseProvider`: el bus y `SyncStore` en el contexto (las pantallas no ven SQL);
      "Reiniciar los datos de este teléfono" con `deleteAccountData` y un reintento.
- [ ] Indicador en el encabezado de Grupos, hoja, avisos con `Toast` y textos `es` y `en`.
- [ ] Commit `feat(sync): indicador de estado, avisos y reinicio de la base local`.

### 11. Cierre

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test -- --watchAll=false`, `npm run test:coverage`,
      `npm run check:bundle`, `npm run test:db:local` y `npx expo-doctor`.
- [ ] Revisión de seguridad con la skill security-code-review en
      `design/fase-4a/revision-seguridad.md`, y corrección de lo que encuentre.
- [ ] Si alguna migración cambió después del punto de control: permiso, `db push` y
      `check:data-api` otra vez.
- [ ] CLAUDE.md: Estado y pendientes (salen "Clave de cifrado perdida" y "`service_role` sin
      privilegios en el remoto"; entran los de la Fase 4b de `diseno.md`).
- [ ] Push, PR y CI en verde.
- [ ] Builds de EAS juntos: development (módulos nativos nuevos) y preview (keystore de EAS).
- [ ] Pasos de prueba en el teléfono: preview sin internet (abrir con la sesión guardada, registrar
      un gasto, ver "pendiente", reconectar y ver "sincronizado"); el teléfono y el emulador con la
      misma cuenta (un cambio en cada uno y un conflicto); reinstalar y ver la descarga; borrar la
      cuenta con `prueba2` y ver que sus grupos ya no están en la nube.
