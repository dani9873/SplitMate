# Fase 2 — Plan de implementación: pantallas del MVP

> **Ejecución:** en la misma sesión, tarea por tarea, con TDD en `src/domain/`, en
> `src/lib/calendar-date.ts` y en los repositorios. Antes de cerrar, la skill
> verification-before-completion. Los pasos usan casillas `- [ ]`.

**Objetivo:** pantallas que permiten llevar los gastos de un grupo de principio a fin en un
solo teléfono, sobre el dominio y la base de la Fase 1.

**Arquitectura:** las rutas de `app/` son delgadas y delegan en `src/features/`. Las
pantallas leen con `useLiveQuery` sobre los repositorios y escriben a través de ellos. Los
repositorios emiten en el bus de cambios después de cada transacción. `src/ui/` tiene los
componentes sin datos.

**Stack nuevo:** react-hook-form 7, @hookform/resolvers 5 y @shopify/flash-list 2 (solo
JS). Maestro CLI fuera del proyecto.

## Restricciones globales

- Ninguna dependencia con código nativo: la fase se prueba con el development build actual.
  El único build nuevo es el del final.
- Montos en enteros de unidades menores; nunca se suman monedas distintas.
- `occurred_on` es un día de calendario local `YYYY-MM-DD`; los instantes, UTC.
- Cero textos fijos en JSX; claves en `es.json` y `en.json`, con plurales.
- `app/`, `src/features/` y `src/ui/` no importan `drizzle-orm`, `expo-sqlite` ni el esquema.
- Áreas táctiles de 44 px o más; saldos nunca solo por color; contraste AA en ambos temas.
- Commits pequeños en español con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Cobertura de `src/domain/` en 100 % (ramas 95 %).

## Mapa de archivos

| Archivo                                 | Responsabilidad                                                |
| --------------------------------------- | -------------------------------------------------------------- |
| `src/domain/expression.ts`              | Evaluador exacto del monto                                     |
| `src/lib/calendar-date.ts`              | Días de calendario locales y su formato                        |
| `src/lib/locale.ts`                     | Locale efectivo y formateadores `Intl` reutilizados            |
| `src/db/changes.ts`                     | Bus de cambios                                                 |
| `src/db/use-live-query.ts`              | Lectura reactiva con carga, error y reintento                  |
| `src/db/schema.ts`, `migrations/0002_*` | Columnas de grupo, índice de "yo" y `local_settings`           |
| `src/db/repositories/profile.ts`        | Usuario local                                                  |
| `src/db/repositories/members.ts`        | Miembros (sale de `groups.ts`)                                 |
| `src/db/repositories/activity.ts`       | Historial normalizado                                          |
| `src/db/repositories/drafts.ts`         | Borradores por grupo                                           |
| `src/ui/*`                              | Teclado, segmentado, chips, avatar, calendario, aviso, estados |
| `src/features/groups/*`                 | Lista, crear, ajustes del grupo y miembros                     |
| `src/features/group-detail/*`           | Detalle con Movimientos y Saldos                               |
| `src/features/entries/*`                | Formulario, detalle y borradores de movimientos                |
| `src/features/balances/*`               | Saldos y liquidación                                           |
| `src/features/activity/*`               | Lista agrupada, filtros y pestaña global                       |
| `src/features/undo/*`                   | Proveedor del aviso con "Deshacer"                             |
| `src/features/sample-data/*`            | Datos de ejemplo, solo en desarrollo                           |
| `.maestro/*`                            | Flujo E2E e instrucciones                                      |

## Tareas

### 1. Calendario local

**Archivos:** `src/lib/calendar-date.ts`, `src/lib/__tests__/calendar-date.test.ts`.

**Produce:** `type CalendarDate = string` (`YYYY-MM-DD`), `today(now?: Date)`,
`addDays(date, n)`, `toUtcDate(date)` (medianoche UTC para formatear con
`timeZone: 'UTC'`), `fromParts(y, m, d)`, `monthGrid(year, month)`.

- [ ] Prueba: con `process.env.TZ = 'America/Bogota'`, a las 23:30 locales del 9 de octubre
      `today()` devuelve `2026-10-09` (en UTC ya es el 10).
- [ ] Prueba: en `Pacific/Kiritimati` (UTC+14), `2026-10-09` se formatea como 9 de octubre.
- [ ] Prueba: `addDays` cruza meses, años y el 29 de febrero.
- [ ] Implementar, ver verde, commit.

### 2. Evaluador del monto (TDD)

**Archivos:** `src/domain/expression.ts`, `src/domain/__tests__/expression.test.ts`,
`src/domain/index.ts`.

**Produce:**

```ts
export const MAX_EXPRESSION_LENGTH = 64;
export const MAX_AMOUNT_INTEGER_DIGITS = 10;
export type AmountProblem =
  | 'EMPTY'
  | 'INCOMPLETE'
  | 'MALFORMED'
  | 'TOO_MANY_DECIMALS'
  | 'DIVISION_BY_ZERO'
  | 'NOT_POSITIVE'
  | 'TOO_LARGE'
  | 'TOO_LONG';
export type AmountEvaluation =
  | { readonly ok: true; readonly value: Money }
  | { readonly ok: false; readonly problem: AmountProblem };
export function evaluateAmount(expression: string, currency: string): AmountEvaluation;
```

- [ ] Pruebas, una por motivo de la tabla del diseño, más: `12.50+8*2` = 2850 USD;
      `10/3` = 333 USD (redondeo único al final); `0.125*2` con KWD; `2.5*3` = 8 JPY
      (redondeo bancario de 7,5); `12.` vale 12; precedencia `2+3*4` = 14 y `8/2*4` = 16.
- [ ] Propiedad con fast-check: para `a+b` con montos válidos, el resultado es la suma
      exacta.
- [ ] Verlas fallar, implementar con racionales `bigint`, verde, cobertura 100 %, commit.

### 3. Bus de cambios

**Archivos:** `src/db/changes.ts`, `src/db/__tests__/changes.test.ts`.

**Produce:** `createChangeBus(log?)`, tipos `DataChange`, `ChangeSource`, `TableName`.

- [ ] Pruebas: `subscribe` recibe el cambio; `batch` anidado emite una vez con la unión de
      tablas y grupos; una excepción dentro de `batch` no emite; un listener que lanza no
      impide a los demás; `unsubscribe` deja de recibir.
- [ ] Implementar, verde, commit.

### 4. Migración 0002 y esquema

**Archivos:** `src/db/schema.ts`, `src/db/migrations/0002_*.sql` y su snapshot,
`src/db/__tests__/schema.test.ts`, `src/db/__tests__/migration-0002.test.ts`.

- [ ] Agregar en `schema.ts`: `groups.emoji`, `groups.color` (enum de la paleta, por
      defecto `teal`), `groups.archivedAt`; índice único parcial `group_members_user_unique`
      en `(group_id, user_id)` con `user_id IS NOT NULL AND deleted_at IS NULL`; tabla
      `localSettings`.
- [ ] `npx drizzle-kit generate --name grupos_apariencia_y_ajustes_locales`. Si el SQL
      reconstruye tablas, se reescribe a mano con `ALTER TABLE ADD COLUMN` (con `CHECK` de
      columna) y se documenta en el propio archivo.
- [ ] Prueba: migrar hasta la 0001 en una carpeta temporal, sembrar datos, aplicar la 0002 y
      comprobar que los datos siguen y las columnas nuevas tienen sus valores por defecto.
- [ ] Prueba: el índice impide dos miembros activos del mismo usuario en un grupo.
- [ ] Commit.

### 5. Repositorios

**Archivos:** `src/db/repositories/{groups,members,profile,expenses,transfers,activity,drafts,errors,validation,index}.ts`
y sus pruebas en `src/db/__tests__/`.

**Produce (firmas principales):**

```ts
createRepositories(db, deps, bus?: ChangeBus)  // bus por defecto: uno nuevo
profile.get(): User | null
profile.ensure(displayName: string): User
groups.update(id, version, { name, emoji, color, currency }): Group
groups.archive(id, version): Group;  groups.unarchive(id, version): Group
groups.listSummaries(): GroupSummary[]   // { group, memberCount, me: Member | null, myBalance: Money | null }
members.add(groupId, displayName): Member
members.rename(id, version, displayName): Member
members.remove(id, version): void        // MEMBER_HAS_BALANCE, LAST_MEMBER
members.setCurrentMember(groupId, memberId | null): void
members.listAll(groupId): Member[]       // incluye quitados
expenses.get(id): ExpenseWithParts | undefined
expenses.update(id, version, input: AddExpenseInput): ExpenseWithParts
expenses.restore(id, version): void
transfers.get / update / remove / restore
activity.list({ groupId? }): ActivityItem[]
drafts.get(groupId): EntryDraft | null;  drafts.save(groupId, draft);  drafts.discard(groupId)
```

- [ ] Pruebas antes de cada método: reglas (`CURRENCY_LOCKED`, `GROUP_ARCHIVED`,
      `MEMBER_HAS_BALANCE`, `LAST_MEMBER`), bloqueo optimista, restaurar solo las filas
      hijas del mismo borrado, `update` con un miembro quitado que ya estaba en el gasto,
      `listSummaries` con y sin "yo", `activity` ordenada por fecha e id, borrador inválido
      descartado.
- [ ] Pruebas del bus: cada escritura emite una vez con sus tablas y su grupo; una escritura
      que falla no emite.
- [ ] Retirar `use-database-changes.ts` y `enableChangeListener`; `DatabaseProvider` crea el
      bus y lo expone en el contexto.
- [ ] Commits por repositorio.

### 6. Lectura reactiva y formato

**Archivos:** `src/db/use-live-query.ts`, `src/lib/locale.ts` y pruebas.

**Produce:** `useLiveQuery<T>(read: (repos) => T, { tables, groupId?, deps })` →
`{ status: 'loading' | 'ready' | 'error', data, error, retry }`; `useFormatters()` →
`{ locale, money(m), date(d, style), relativeDay(d) }`.

- [ ] Prueba con sql.js: la lectura se repite tras una escritura de su grupo y no tras la de
      otro grupo; el error expone `retry`.
- [ ] Commit.

### 7. Componentes de UI

**Archivos:** `src/ui/{Keypad,AmountDisplay,SegmentedControl,Chip,Avatar,ListRow,IconButton,SearchField,Calendar,Checkbox,Stepper,Skeleton,ErrorState,Toast,Sheet}.tsx`,
`src/ui/theme/group-colors.json`, `src/ui/theme/__tests__/contrast.test.ts`.

- [ ] Prueba de contraste de todos los pares de tokens y de la paleta de grupos, en claro y
      oscuro. Ajustar colores hasta que pase.
- [ ] Pruebas RNTL: teclado (nombres accesibles, sin decimal en JPY, mantener ⌫ y la acción
      accesible "borrar todo"), segmentado (rol `tab` y estado seleccionado), calendario
      (etiqueta con la fecha completa, mes anterior y siguiente), aviso (anuncio y botón).
- [ ] Commits por grupo de componentes.

### 8. Grupos y miembros

**Archivos:** `src/features/groups/*`, `app/(tabs)/index.tsx`, `app/groups/new.tsx`,
`app/groups/[groupId]/settings.tsx`, `app/_layout.tsx` (rutas modales).

- [ ] Lista con FlashList, tarjetas, estados y sección de archivados.
- [ ] Crear grupo con react-hook-form + zod (`profile.ensure` y `groups.create`).
- [ ] Ajustes del grupo: campos, moneda bloqueada con explicación, miembros, "Soy yo",
      archivar y restaurar con confirmación.
- [ ] Pruebas RNTL de crear, renombrar, quitar con y sin saldo, y archivar.
- [ ] Commit.

### 9. Movimientos

**Archivos:** `src/features/entries/*`, `app/groups/[groupId]/entries/*`.

- [ ] Esquemas del formulario y su conversión a la entrada del repositorio, con pruebas
      unitarias (los cuatro métodos, varios pagadores, otra moneda, porcentajes con dos
      decimales a puntos básicos).
- [ ] Campo de monto con el teclado y mensajes de `AmountProblem`.
- [ ] Editor de pagadores y de división con vista previa en vivo.
- [ ] Transferencias e ingresos.
- [ ] Detalle, edición y borrado con deshacer.
- [ ] Borradores: guardar al pasar a segundo plano o al cerrar sin guardar; ofrecer al abrir.
- [ ] Pruebas RNTL de cada caso, incluido el borrador con `AppState`.
- [ ] Commits.

### 10. Saldos

**Archivos:** `src/features/balances/*`, `src/features/group-detail/*`,
`app/groups/[groupId]/index.tsx`.

- [ ] Filas con barra, texto y flecha; miembros quitados con saldo; "Todos están al día".
- [ ] "Marcar como pagada" con deshacer.
- [ ] Pruebas RNTL: nombres accesibles sin depender del color; deshacer elimina la
      transferencia.
- [ ] Commit.

### 11. Actividad

**Archivos:** `src/features/activity/*`, `app/(tabs)/activity.tsx`.

- [ ] Filtro puro (`filterActivity`) con pruebas: texto sin tildes, categoría, miembro.
- [ ] Agrupación por día con un encabezado por día (ver la nota del diseño sobre los fijos).
- [ ] Pestaña global con el grupo en cada fila y la moneda de cada fila, sin totales.
- [ ] Commit.

### 12. Datos de ejemplo y retiro de `/dev`

- [ ] Borrar `app/dev.tsx` y `src/features/dev/`; crear `src/features/sample-data/` con su
      marca `splitmate-sample-data-v1` y el botón en Ajustes bajo `__DEV__`.
- [ ] Actualizar `scripts/check-prod-bundle.mjs` y correr `npm run check:bundle` y
      `npm run check:bundle -- --dev`.
- [ ] Commit.

### 13. Flujo completo y Maestro

- [ ] `src/features/__tests__/flujo-grupo.test.tsx` con `renderRouter` y sql.js: el recorrido
      del diseño hasta saldos en cero.
- [ ] `.maestro/config.yaml`, `.maestro/flujo-grupo-liquidar.yaml` y `.maestro/README.md`.
- [ ] Instalar Maestro CLI y correr el flujo en el emulador. Si no funciona en Windows,
      documentarlo y seguir.
- [ ] Commit.

### 14. Cierre

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test -- --watchAll=false`,
      `npm run test:coverage`, `npm run check:bundle`, `npx expo-doctor`.
- [ ] Revisión de seguridad con la skill security-code-review.
- [ ] Capturas en claro y oscuro en `design/capturas/fase-2/`.
- [ ] CLAUDE.md: Estado y pendientes.
- [ ] Push, PR y CI en verde.
- [ ] Development build en EAS y enlace al usuario.
