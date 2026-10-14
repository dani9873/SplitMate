# Fase 4a — Plan de implementación: sincronización con Supabase

> **Ejecución:** en la misma sesión, paso por paso, con un commit por paso y `progreso.md` en el
> mismo commit. El usuario pide detenerse cada 2 pasos. TDD en el motor de sincronización
> (skill test-driven-development) y pgTAP antes de cada migración. Antes de cerrar, la skill
> verification-before-completion. Los pasos usan casillas `- [ ]`.

**Objetivo:** que los datos de cada cuenta vivan en Supabase y se sincronicen entre dispositivos sin
perder el funcionamiento offline-first. Diseño aprobado en `design/fase-4a/diseno.md`, con los siete
ajustes de la revisión.

**Arquitectura:**

- `supabase/migrations`: columnas que pone el servidor, contador de cambios por grupo, guardia de
  escritura, reglas, RLS con acceso del creador, `sync_push` (concurrencia estricta, idempotencia,
  límites e historial) y `sync_pull` (incremental).
- `src/db/sync/`: todo lo que toca SQLite (filas pendientes, envíos, borradores de conflicto, aplicar
  datos del servidor, cursores) detrás de `SyncStore`, más el contrato de red validado con zod.
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
- Ningún conflicto borra datos del usuario: lo rechazado queda como borrador por revisar.
- Todo dato que llega de la red se valida con zod.
- `app/`, `src/features/` y `src/ui/` no importan SQL, Drizzle ni el esquema.
- Cero textos fijos en JSX (i18n `es` y `en`), áreas táctiles de 44 px y contraste AA.
- Los registros nunca llevan montos, nombres, correos ni tokens.
- Versiones fijas: Supabase CLI 2.120.0, `eas-cli` 24.12.1 (`npx -y eas-cli@24.12.1`), PGlite 0.5.8.
- Ante EPERM, EBUSY o archivos bloqueados en npm o Gradle (OneDrive): detenerse y avisar.

## Mapa de archivos

| Archivo                                                                | Responsabilidad                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `eas.json`                                                             | Perfil `preview` con `environment: preview`                               |
| `supabase/migrations/*_sincronizacion_base.sql`                        | Columnas del servidor, `change_seq`, guardia, reglas, RLS, privilegios    |
| `supabase/migrations/*_sync_push.sql`                                  | `sync_mutations`, `change_log`, `sync_push` y funciones de apoyo          |
| `supabase/migrations/*_sync_pull.sql`                                  | `sync_pull`                                                               |
| `supabase/migrations/*_borrar_cuenta_grupos.sql`                       | Borrar la cuenta borra sus grupos no compartidos                          |
| `supabase/tests/database/007` a `011`                                  | pgTAP de columnas, envío, historial, descarga y borrado de cuenta         |
| `supabase/tests/pglite/plataforma.sql`                                 | Lo mínimo de Supabase para PGlite: roles, `auth.users`, `auth.uid()`      |
| `scripts/test-db-local.mjs`                                            | `npm run test:db:local`: migraciones y pgTAP en PGlite, sin Docker        |
| `scripts/check-data-api.mjs`                                           | Suma las comprobaciones de las RPC, del historial y de la guardia         |
| `src/db/schema.ts` y `src/db/migrations/0004_*`                        | `server_version`, `synced_version`, `group_currency` y tablas de sync     |
| `src/db/sync/wire.ts`                                                  | Contrato de red: tipos y esquemas zod                                     |
| `src/db/sync/units.ts`                                                 | Unidades (grupo, miembro, categoría, gasto, transferencia) y sus columnas |
| `src/db/sync/outbox.ts`                                                | Lotes de envío y aplicar respuestas                                       |
| `src/db/sync/conflicts.ts`                                             | Borradores por revisar                                                    |
| `src/db/sync/apply.ts`                                                 | Aplicar filas del servidor en una transacción por grupo                   |
| `src/db/sync/remote.ts`                                                | `SyncRemote` sobre una llamada RPC inyectada                              |
| `src/db/sync/store.ts`                                                 | `SyncStore`: la API que usa el motor                                      |
| `src/lib/supabase/rpc.ts`                                              | RPC con supabase-js, tiempo límite y errores clasificados                 |
| `src/test/supabase-pglite.ts`                                          | Servidor de prueba: PGlite con las migraciones y fallas a propósito       |
| `src/features/sync/cycle.ts`                                           | Un ciclo: envío por lotes y descarga por páginas                          |
| `src/features/sync/engine.ts`                                          | Cuándo sincronizar, un ciclo a la vez, reintentos y estado                |
| `src/features/sync/network.ts`                                         | Adaptador de `expo-network`                                               |
| `src/features/sync/SyncProvider.tsx`                                   | Crea el motor por cuenta, `AppState`, red y contexto                      |
| `src/features/sync/{SyncStatusButton,SyncStatusSheet,SyncNotices}.tsx` | Indicador, hoja de estado y avisos                                        |
| `src/features/sync/{ConflictBanner,ConflictSheet}.tsx`                 | Borradores por revisar en el detalle del grupo                            |
| `src/features/sync/test-utils.ts`                                      | Dispositivos simulados para las pruebas                                   |
| `app/(app)/_layout.tsx`                                                | Monta `SyncProvider`; el perfil remoto pasa al motor                      |
| `src/db/DatabaseProvider.tsx`                                          | Bus y `SyncStore` en el contexto; "Reiniciar los datos de este teléfono"  |

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
export type RejectReason = 'conflict' | 'currency_locked' | 'group_currency_changed';
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
  | {
      readonly id: string;
      readonly status: 'failed';
      readonly reason: FailReason;
      readonly field?: string;
    };
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

// src/db/sync/conflicts.ts
export interface ConflictDraft {
  readonly id: string;
  readonly entity: SyncEntity;
  readonly entityId: string;
  readonly groupId: string;
  readonly reason: RejectReason;
  readonly data: Readonly<Record<string, unknown>>; // la versión rechazada, tal como se envió
  readonly serverDeleted: boolean; // en el servidor está borrada
  readonly wasNew: boolean; // nunca llegó al servidor
  readonly wasDeletion: boolean; // el cambio rechazado era un borrado
  readonly createdAt: number;
}

// src/db/sync/store.ts
export interface SyncNotice {
  readonly draftId: string;
  readonly groupId: string;
  readonly entity: SyncEntity;
  readonly reason: RejectReason;
  readonly label: string; // nombre del grupo o miembro, título del movimiento
  readonly serverDeleted: boolean;
  readonly wasNew: boolean;
  readonly wasDeletion: boolean;
}
export interface SyncCounts {
  readonly pending: number;
  readonly failed: number;
  readonly conflicts: number;
}
export interface ApplyOutcome {
  readonly applied: number;
  readonly skipped: number;
  readonly held: boolean;
}
export interface SyncStore {
  counts(): SyncCounts;
  nextBatch(limits: { readonly count: number; readonly bytes: number }): Mutation[];
  applyPushResults(results: readonly PushResult[]): SyncNotice[];
  cursors(): Record<string, number>;
  applyRemoteGroup(changes: RemoteGroupChanges): ApplyOutcome;
  retryFailed(): number;
}
export function createSyncStore(
  db: AppDatabase,
  bus: ChangeBus,
  deps: { now(): number; newId(): string },
): SyncStore;

// src/features/sync/engine.ts
export type SyncTrigger = 'open' | 'foreground' | 'reconnect' | 'local-change' | 'manual';
export type SyncState = 'synced' | 'pending' | 'offline' | 'error';
export interface SyncStatus {
  readonly state: SyncState;
  readonly syncing: boolean;
  readonly pending: number;
  readonly failed: number;
  readonly conflicts: number;
  readonly lastSyncedAt: number | null;
}
export interface SyncEngine {
  start(): void;
  stop(): void;
  request(trigger: SyncTrigger): void;
  /** Corre un ciclo (o espera el que corre y uno más) y devuelve el estado al terminar. */
  syncNow(): Promise<SyncStatus>;
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
      antes la sintaxis con `--help` (`env:create` está obsoleto). Comprobar con la salida
      enmascarada.
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

### 3. Servidor: `sync_push` con historial

**Archivos:** `supabase/migrations/*_sync_push.sql`,
`supabase/tests/database/008-sync-push.test.sql`, `009-historial.test.sql`, `001` y `006`.

**Produce (SQL):**

- `private.sync_mutations (user_id uuid references auth.users on delete cascade, mutation_id uuid,
entity text, entity_id uuid, version integer, applied_at timestamptz default now(),
primary key (user_id, mutation_id))`.
- `public.change_log (id bigint generated always as identity primary key, group_id uuid not null
references public.groups on delete cascade, entity text, entity_id uuid, action text, fields
text[], snapshot jsonb, version integer, actor uuid, mutation_id uuid, changed_at timestamptz
default now())` con índices `(group_id, id)` y `(entity_id)`, RLS (`SELECT` con
  `can_access_group`), solo `SELECT` para `authenticated` y un trigger que rechaza `UPDATE`,
  `DELETE` y `TRUNCATE` salvo el `DELETE` en cascada (`pg_trigger_depth() > 1`).
- `public.sync_push(p_mutations jsonb) returns jsonb` (`SECURITY INVOKER`, `VOLATILE`).
- Apoyo en `private`:
  - `sync_find_mutation(uuid) returns integer` y `sync_remember_mutation(uuid, text, uuid,
integer)` (`SECURITY DEFINER`, solo filas de `auth.uid()`);
  - `record_change(uuid, text, uuid, text, integer, text[], jsonb, uuid)` (`SECURITY DEFINER`,
    autor `auth.uid()`, revisa el acceso al grupo);
  - `lock_group_changes(uuid)` (`SECURITY DEFINER`);
  - validadores que lanzan `SMINV` con el campo: `sync_text`, `sync_int`, `sync_uuid`, `sync_bool`,
    `sync_date`, `sync_enum` y `sync_keys`;
  - `sync_entity_rows(text, uuid) returns jsonb`;
  - `sync_apply_group`, `sync_apply_member`, `sync_apply_category`, `sync_apply_expense` y
    `sync_apply_transfer` (`(p_data jsonb, p_base integer, p_mutation uuid) returns integer`,
    `SECURITY INVOKER`; devuelven la versión, o la actual si no hubo que escribir).
- Errores: `SMCFL` (conflicto de versión), `SMINV` (campo inválido), `SMNFD` (versión de algo que no
  existe), más `SMCUR` y `SMGCC` del paso 2; `22023` y `54000` para el sobre.

- [ ] Pruebas primero en `008-sync-push`:
  - alta de grupo, miembros, gasto con pagadores y partes, y transferencia en una llamada; `current`
    con el estado final;
  - el mismo envío otra vez: `applied` con la misma versión, sin filas nuevas, sin `version` de más
    ni historial de más, aunque otro cambio haya llegado entre medio;
  - base vieja al editar, borrar, restaurar, archivar, desarchivar, cambiar la moneda o un gasto
    con sus partes: `rejected: conflict` con `current`, sin escribir nada;
  - "soy yo" sobre un miembro cuando otro tiene tu cuenta en el grupo: `rejected: conflict`;
  - un cambio que deja todo igual al servidor, con base vieja: `applied` sin escribir;
  - moneda al día con movimientos: `rejected: currency_locked`;
  - movimiento con otra `group_currency`: `rejected: group_currency_changed` (`current` vacío si es
    nuevo);
  - sumas que no cuadran, tasa distinta de 1 en la moneda del grupo, miembro repetido, parte
    existente con otro monto, cambio de `group_id`: `failed: invalid` con el campo;
  - grupo ajeno: `failed: forbidden`; `base` de una fila inexistente: `failed: not_found`;
  - un envío inválido no frena a los demás de la misma llamada;
  - **límites:** lista vacía → `[]`; 51 envíos → error 400; más de 512 KiB → error 413; sobre sin
    `data`, con `entity` desconocida o `base` no entera → error 400; clave desconocida en `data`,
    texto de 81 caracteres, texto solo con espacios, monto como texto, monto decimal, monto de
    100 000 000 000 000, fecha inexistente, UUID mal formado, enumerado desconocido y 51 pagadores
    → `failed: invalid` con el campo;
  - `anon` no la ejecuta.
- [ ] Pruebas primero en `009-historial`:
  - un alta, una edición, un borrado y una restauración escriben una entrada cada uno, con autor,
    acción, campos, versión, envío y la unidad completa en `snapshot`;
  - reenvíos, cambios idénticos y rechazos no escriben;
  - Ana lee el historial de sus grupos, Beto el del grupo que comparte con ella y Caro ninguno;
    `anon` nada;
  - `authenticated` no inserta, edita ni borra (privilegios); `service_role` no tiene nada;
  - como `postgres`, `UPDATE`, `DELETE` y `TRUNCATE` fallan; borrar el grupo en cascada sí borra su
    historial.
- [ ] Migración. `npm run test:db:local` en verde; push y CI verde.
- [ ] Commit `feat(supabase): sync_push con concurrencia estricta, límites e historial`.

### 4. Servidor: `sync_pull`, borrar la cuenta y `check:data-api`

**Archivos:** `supabase/migrations/*_sync_pull.sql`, `*_borrar_cuenta_grupos.sql`,
`supabase/tests/database/010-sync-pull.test.sql`, `011-borrar-cuenta.test.sql`, `001`, `006` y
`scripts/check-data-api.mjs`.

**Produce (SQL):** `public.sync_pull(p_cursors jsonb, p_max_rows integer default 2000) returns
jsonb` (`SECURITY INVOKER`, `STABLE`); `private.delete_unshared_groups()` (`SECURITY DEFINER`) en
un trigger `BEFORE DELETE` de `profiles`.

- [ ] Pruebas primero en `010-sync-pull`:
  - sin cursores trae cada grupo con acceso con todas sus filas, borradas incluidas, y el `cursor`
    más alto;
  - con el cursor devuelto, una segunda llamada sin cambios no trae nada; tras un cambio, solo esa
    fila (incremental);
  - páginas con `has_more`: los cambios de un grupo nunca se parten; un grupo más grande que el
    límite sale solo;
  - un usuario no ve grupos de otro; `anon` no la ejecuta;
  - **límites:** 1001 cursores, una clave que no es UUID, un cursor negativo o decimal, y
    `p_max_rows` de 99 o 5001 → error 400.
- [ ] Pruebas primero en `011-borrar-cuenta`: al borrar la cuenta de Ana se borran "Oficina" (Ana y
      Yago, sin otra cuenta) con todas sus filas y su historial, y queda "Viaje" (Beto tiene
      cuenta) con el miembro de Ana sin cuenta; sus envíos de `sync_mutations` también se borran.
- [ ] Migraciones.
- [ ] `check:data-api`: `anon` no ejecuta las RPC ni lee `change_log`; `authenticated` ejecuta
      `sync_pull` (sin grupos) y `sync_push([])`, lee `change_log` y no le escribe; un `POST`
      directo a `groups` con nombre vacío da `42501` (y no `23514`).
- [ ] `npm run test:db:local`, push y CI verde.
- [ ] Commit `feat(supabase): sync_pull incremental y borrado de grupos al borrar la cuenta`.

**Punto de control:** pedir permiso para `supabase db push` de las cuatro migraciones
(`db push --dry-run` primero). Después, `npm run check:data-api` contra el remoto.

### 5. Base local: columnas y tablas de sincronización

**Archivos:** `src/db/schema.ts`, `src/db/migrations/0004_*.sql` y su `meta`, `migrations.js`,
`src/db/repositories/{expenses,transfers,errors,validation}.ts`, `src/i18n/locales/{es,en}.json` y
pruebas en `src/db/__tests__/`.

**Produce:** en el esquema, `serverVersion` y `syncedVersion` en las 7 tablas sincronizables
(`users` no cambia), `groupCurrency` en `expenses` y `transfers`, `syncOutbox`, `syncCursors` y
`syncConflicts`, e índices parciales de pendientes; el error de repositorio `CURRENCY_CHANGED`;
`MAX_MINOR_AMOUNT = 99_999_999_999_999` en la validación.

- [ ] Pruebas primero:
  - `migration-0004.test.ts`: una base con datos de las Fases 1 a 3 migra con `group_currency` de
    su grupo, las 9 predefinidas sincronizadas y todo lo demás pendiente;
  - repositorios: registrar y editar guardan `groupCurrency`; restaurar un movimiento cuya moneda de
    grupo cambió falla con `CURRENCY_CHANGED`; un monto de 100 000 000 000 000 se rechaza; toda
    escritura deja la unidad pendiente (`synced_version` distinta de `version`).
- [ ] `schema.ts` y `npx drizzle-kit generate --name sincronizacion`. A mano en el `.sql`: el CHECK
      de `group_currency` como restricción de columna (así no se reconstruye la tabla) y los
      `UPDATE` de relleno. `assertMigrationsHaveSql` cubre la migración nueva.
- [ ] Repositorios, validación y textos `es` y `en` de `CURRENCY_CHANGED`.
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
    5xx → `server`, 401 → `auth`, 400 y 413 → `protocol`.
- [ ] Implementación. Si PGlite no carga en el entorno de Jest, cargarlo en un proceso hijo con el
      mismo contrato `RpcCall`.
- [ ] Commit `test(sync): servidor de prueba con PGlite y cliente remoto validado`.

### 7. Motor, parte 1 (TDD): envío y borradores de conflicto

**Archivos:** `src/db/sync/{units,outbox,conflicts,apply,store,index}.ts`,
`src/features/sync/{cycle,test-utils}.ts` y pruebas.

**Produce:** `createSyncStore` con `counts`, `nextBatch`, `applyPushResults` y `retryFailed`;
`listConflicts(groupId?)`, `getConflict(id)` y `discardConflict(id)` en `conflicts.ts`;
`runSyncCycle({ store, remote, batch = { count: 50, bytes: 262_144 }, pullMaxRows = 2000 })` (en
este paso solo envía); `createDevice(server, userId)` en `test-utils.ts`: base sql.js,
repositorios, `SyncStore`, `sync()` y `snapshot()` comparable entre dispositivos.

- [ ] Pruebas de unidad primero (`outbox.test.ts`, sql.js):
  - orden por grupo y dependencias; el gasto lleva solo sus pagadores y partes activos; el lote no
    pasa de 50 envíos ni de 256 KiB;
  - el lote queda guardado antes de devolverse; un envío sin respuesta se repite con el mismo id y
    contenido;
  - `applied` sin cambios en vuelo: aplica `current` y la unidad queda al día; con cambios en vuelo:
    guarda `server_version` y sigue pendiente;
  - `rejected`: guarda el borrador con la versión enviada, aplica `current` y avisa; con `current`
    vacío el movimiento sale de los movimientos y sus datos quedan completos en el borrador (nada se
    borra sin borrador);
  - `failed`: queda apartada, fuera de los lotes; `retryFailed` la devuelve;
  - las predefinidas nunca se envían.
- [ ] Pruebas con dos dispositivos y PGlite primero (`push.int.test.ts`):
  - el teléfono crea grupo, miembros y gastos; el servidor queda igual a la base local;
  - respuesta perdida después del commit: el reintento no duplica ni sube versiones;
  - sin red antes de enviar: nada llega; al volver, todo una sola vez;
  - error del servidor en el segundo lote: el primero queda confirmado y el segundo se repite;
  - subida inicial de datos viejos, con un grupo sin "yo" y un miembro quitado que sigue en un gasto.
- [ ] Implementación hasta verde.
- [ ] Commit `feat(sync): cola de envío idempotente y borradores de conflicto`.

### 8. Motor, parte 2 (TDD): descarga y conflictos entre dos dispositivos

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
  - **descarga incremental:** un segundo ciclo sin cambios no baja filas; tras un cambio, solo ese;
  - el mismo gasto editado en ambos sin conexión: el primero queda; el segundo recibe el rechazo,
    vuelve a esa versión, guarda su borrador y avisa «Cena» cambió; al guardar el borrador sobre la
    versión actual, los dos convergen;
  - editar algo borrado en el otro: vuelve borrado, borrador y aviso de borrado;
  - borrar algo editado en el otro: vuelve con la versión nueva, borrador de borrado; "Borrar ahora"
    lo borra en ambos;
  - renombrar un grupo cambiado en el otro: vuelve el del servidor y queda el borrador;
  - gasto nuevo sin conexión y moneda cambiada en el otro: sale de los movimientos, queda completo
    como borrador y avisa;
  - "soy yo" cambiado en los dos: el segundo recibe el rechazo y vuelve al del servidor;
  - el mismo cambio en los dos: sin rechazo;
  - un gasto nuevo en un grupo que el otro archivó: se guarda y el grupo sigue archivado;
  - una segunda cuenta no recibe nada de la primera;
  - descarga en varias páginas con `pullMaxRows` chico.
- [ ] Implementación hasta verde.
- [ ] Commit `feat(sync): descarga incremental y conflictos con versión base`.

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
  options?: { debounceMs?: number; maxWaitMs?: number; pullMaxRows?: number };
}): SyncEngine;
```

- [ ] Pruebas primero (`engine.test.ts`, `SyncStore` y `SyncRemote` falsos, `Scheduler` manual):
  - cinco escrituras locales seguidas producen un solo ciclo 2 s después de la última, y como mucho
    10 s después de la primera; los cambios con `source: 'sync'` no disparan nada;
  - `open`, `foreground`, `reconnect` y `manual` sincronizan de inmediato;
  - un pedido durante un ciclo produce exactamente un ciclo más; `syncNow` espera ese ciclo y
    devuelve el estado final;
  - sin red: estado `offline`, sin llamadas; al reconectar, un ciclo;
  - error del servidor: reintentos a 5 s, 15 s, 45 s, 2 min y 5 min (±20 %); un éxito los reinicia;
  - `protocol` o envíos apartados: estado `error`;
  - `start` reintenta los apartados (al abrir la app) y `stop` cancela temporizadores y
    suscripciones;
  - el perfil remoto se asegura una vez por sesión del motor; si no se pudo, el ciclo descarga pero
    no envía, y lo vuelve a intentar en el siguiente;
  - estado con `pending`, `failed`, `conflicts`, `syncing` y `lastSyncedAt`; los avisos del ciclo
    llegan a `onNotice`.
- [ ] `network.ts` con `Network.getNetworkStateAsync` y `addNetworkStateListener`
      (`isConnected` e `isInternetReachable`).
- [ ] Implementación hasta verde.
- [ ] Commit `feat(sync): motor con espera, reintentos y estado`.

### 10. Pantallas: indicador, avisos, sesión y reinicio de la base

**Archivos:** `src/features/sync/{SyncProvider,SyncStatusButton,SyncStatusSheet,SyncNotices,index}.tsx`,
`app/(app)/_layout.tsx`, `src/db/DatabaseProvider.tsx`, `src/features/groups/GroupsScreen.tsx`,
`src/features/account/{SignOutSheet,DeleteAccountScreen}.tsx`,
`src/features/auth/{auth-service,profile-sync}.ts`, `src/i18n/locales/{es,en}.json` y pruebas.

- [ ] Pruebas primero (RNTL, con un motor falso):
  - el indicador muestra cada estado con su nombre accesible y abre la hoja;
  - la hoja muestra pendientes, apartados, borradores y la última sincronización; "Sincronizar
    ahora" y "Reintentar" llaman al motor;
  - un aviso de cada razón muestra su texto y "Revisar";
  - cerrar sesión y borrar: sin pendientes ni borradores, la confirmación dice que los datos están
    en la nube; con pendientes, ofrece "Sincronizar primero" (corre `syncNow` y, si todo subió,
    sigue a la confirmación; si no, vuelve a avisar con los números nuevos), "Borrar de todos modos"
    y "Cancelar"; el texto viejo ("todavía no se guardan en la nube") ya no está;
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
- [ ] Commit `feat(sync): indicador de estado, avisos, cierre de sesión y reinicio de la base`.

### 11. Pantallas: borradores por revisar

**Archivos:** `src/features/sync/{ConflictBanner,ConflictSheet}.tsx`,
`src/features/group-detail/GroupDetailScreen.tsx`, `src/features/entries/{entry-form,EntryFormScreen}.ts(x)`,
`src/features/navigation/route-params.ts`, las rutas de `entries/new` y `entries/[entryId]/edit`,
`src/i18n/locales/{es,en}.json` y pruebas.

**Produce:** `valuesFromConflictDraft(draft, base): EntryFormValues` en `entry-form.ts` (arma un
gasto o una transferencia desde `draft.data` y usa `valuesFromExpense` o `valuesFromTransfer`); el
parámetro de ruta `fromConflict` (UUID validado con zod) en las dos rutas del formulario.

- [ ] Pruebas primero:
  - el detalle del grupo muestra "N cambios por revisar" solo si hay, y abre la lista;
  - un borrador de gasto abre el formulario con la versión del teléfono: como edición si el gasto
    sigue activo (guarda sobre la versión actual) y como alta si no existe o se borró (con la moneda
    actual del grupo); al guardar, el borrador desaparece;
  - un borrador de transferencia, igual;
  - un borrado no aplicado ofrece "Borrar ahora" (borra sobre la versión actual) y "Mantener";
  - un borrador de grupo o de miembro muestra tu versión y la actual en los campos que difieren, y
    "Entendido" lo descarta;
  - "Descartar" pide confirmar y quita el borrador sin tocar los movimientos.
- [ ] Implementación con el sistema de diseño, accesibilidad y textos `es` y `en`.
- [ ] Commit `feat(sync): borradores por revisar en el detalle del grupo`.

### 12. Cierre

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
      misma cuenta (un cambio en cada uno, y un conflicto con su borrador y "Revisar"); reinstalar y
      ver la descarga completa; borrar la cuenta con `prueba2` y ver que sus grupos ya no están en
      la nube.
