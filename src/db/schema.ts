import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// Ruta relativa: drizzle-kit carga este archivo sin los alias de tsconfig.
import { DEFAULT_GROUP_COLOR, GROUP_COLORS } from '../lib/group-appearance';

/**
 * Columnas comunes a toda tabla sincronizable:
 * - `id`: UUID v7 generado en el cliente.
 * - `created_at` y `updated_at`: milisegundos Unix en UTC.
 * - `deleted_at`: borrado lógico; las consultas filtran `deleted_at IS NULL`.
 * - `version`: bloqueo optimista; cada actualización la incrementa.
 */
const syncColumns = () => ({
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  version: integer('version').notNull().default(1),
});

/**
 * Estado de sincronización de las 7 tablas que se envían al servidor (`users` no: su perfil
 * remoto se asegura aparte):
 * - `server_version`: la `version` que tiene el servidor de esta fila; nulo si nunca llegó.
 * - `synced_version`: la `version` local que el servidor ya confirmó.
 *
 * Una fila está pendiente cuando `version <> synced_version`. No hay otra marca: toda
 * escritura local sube `version`, así que queda pendiente sola.
 */
const syncState = () => ({
  serverVersion: integer('server_version'),
  syncedVersion: integer('synced_version').notNull().default(0),
});

/** Columnas comunes más el estado de sincronización, para las tablas que se envían. */
const syncedColumns = () => ({ ...syncColumns(), ...syncState() });

const isActive = (deletedAt: AnySQLiteColumn): SQL => sql`${deletedAt} IS NULL`;
/** Fila con cambios locales que el servidor todavía no confirma. */
const isPending = (syncedVersion: AnySQLiteColumn, version: AnySQLiteColumn): SQL =>
  sql`${syncedVersion} <> ${version}`;
const currencyCheck = (column: AnySQLiteColumn): SQL => sql`${column} GLOB '[A-Z][A-Z][A-Z]'`;
const dateCheck = (column: AnySQLiteColumn): SQL =>
  sql`${column} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`;
const lengthBetween = (column: AnySQLiteColumn, min: number, max: number): SQL =>
  sql`length(${column}) BETWEEN ${sql.raw(String(min))} AND ${sql.raw(String(max))}`;
const rateCheck = (column: AnySQLiteColumn): SQL =>
  sql`${column} GLOB '[0-9]*' AND ${column} NOT GLOB '*[^0-9.]*'`;

export const users = sqliteTable(
  'users',
  {
    ...syncColumns(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    /**
     * Cuenta ajena que solo aparece como creadora de un grupo, como dueña de un acceso o como
     * cuenta de un miembro: fila mínima (el id y un nombre de relleno) para que las claves
     * foráneas valgan. Nunca se muestra ni se envía; las personas se muestran por su miembro.
     */
    isRemote: integer('is_remote', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    check('users_display_name_length', lengthBetween(t.displayName, 1, 80)),
    check('users_version_positive', sql`${t.version} >= 1`),
  ],
);

export const groups = sqliteTable(
  'groups',
  {
    ...syncedColumns(),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Los CHECK de `emoji` y `color` viven en la migración 0002 como restricciones de columna.
    /** Emoji del grupo; sin emoji, la UI muestra la inicial del nombre. */
    emoji: text('emoji'),
    /** Clave de la paleta de grupos, no un color literal: cada tema tiene su variante. */
    color: text('color', { enum: GROUP_COLORS }).notNull().default(DEFAULT_GROUP_COLOR),
    /** Instante en que se archivó. Un grupo archivado es de solo lectura. */
    archivedAt: integer('archived_at'),
    /**
     * Instante en que el servidor dijo que esta cuenta ya no ve el grupo (expulsión, salida desde
     * otro teléfono o borrado definitivo). El grupo queda como copia de solo lectura hasta que
     * la persona lo quite del teléfono o vuelva a entrar con otra invitación. Local: no se sube.
     */
    accessLostAt: integer('access_lost_at'),
  },
  (t) => [
    check('groups_name_length', lengthBetween(t.name, 1, 80)),
    check('groups_currency_format', currencyCheck(t.currency)),
    check('groups_version_positive', sql`${t.version} >= 1`),
    index('groups_active_updated_idx').on(t.updatedAt).where(isActive(t.deletedAt)),
    index('groups_pending_idx').on(t.id).where(isPending(t.syncedVersion, t.version)),
  ],
);

export const groupMembers = sqliteTable(
  'group_members',
  {
    ...syncedColumns(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['owner', 'member'] })
      .notNull()
      .default('member'),
  },
  (t) => [
    check('group_members_display_name_length', lengthBetween(t.displayName, 1, 80)),
    check('group_members_role', sql`${t.role} IN ('owner', 'member')`),
    check('group_members_version_positive', sql`${t.version} >= 1`),
    index('group_members_group_idx').on(t.groupId).where(isActive(t.deletedAt)),
    // Un usuario es a lo sumo un miembro activo de cada grupo: hay un solo "yo".
    uniqueIndex('group_members_user_unique')
      .on(t.groupId, t.userId)
      .where(sql`${t.userId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('group_members_pending_idx').on(t.id).where(isPending(t.syncedVersion, t.version)),
  ],
);

/**
 * Quién tiene acceso a cada grupo, tal como lo dice el servidor: una fila por cuenta y grupo. Es
 * de solo bajada (la app nunca la edita ni la sube), por eso no lleva el estado de sincronización
 * y `version` es la del servidor. `deleted_at` con valor quiere decir «sin acceso».
 */
export const groupAccess = sqliteTable(
  'group_access',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    /** La invitación por la que entró; nulo para el dueño original. */
    invitationId: text('invitation_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    version: integer('version').notNull(),
  },
  (t) => [
    check('group_access_role', sql`${t.role} IN ('owner', 'member')`),
    check('group_access_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('group_access_group_user_unique').on(t.groupId, t.userId),
    index('group_access_user_idx').on(t.userId),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    ...syncedColumns(),
    /** Nulo en las predefinidas, que son comunes a todos los grupos. */
    groupId: text('group_id').references(() => groups.id, { onDelete: 'restrict' }),
    /** Clave de traducción de las predefinidas, por ejemplo `food`. */
    key: text('key'),
    /** Nombre libre de las personalizadas. */
    name: text('name'),
    /** Nombre de un ícono de Lucide. */
    icon: text('icon').notNull(),
  },
  (t) => [
    check('categories_key_or_name', sql`(${t.key} IS NULL) <> (${t.name} IS NULL)`),
    check('categories_custom_has_group', sql`(${t.key} IS NULL) = (${t.groupId} IS NOT NULL)`),
    check('categories_name_length', sql`${t.name} IS NULL OR ${lengthBetween(t.name, 1, 40)}`),
    check('categories_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('categories_key_unique')
      .on(t.key)
      .where(sql`${t.key} IS NOT NULL`),
    index('categories_group_idx').on(t.groupId).where(isActive(t.deletedAt)),
    index('categories_pending_idx').on(t.id).where(isPending(t.syncedVersion, t.version)),
  ],
);

export const expenses = sqliteTable(
  'expenses',
  {
    ...syncedColumns(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
    /**
     * Moneda del grupo cuando se registró el gasto. El servidor exige que coincida con la actual
     * y por eso `restore` falla con `CURRENCY_CHANGED` si el grupo cambió de moneda. El CHECK de
     * formato vive en la migración 0004 como restricción de columna (como el de la 0002), y allí
     * también el DEFAULT que SQLite exige para agregar una columna NOT NULL: el código no lo usa,
     * siempre manda el valor.
     */
    groupCurrency: text('group_currency').notNull(),
    kind: text('kind', { enum: ['expense', 'income'] }).notNull(),
    title: text('title').notNull(),
    /** Monto original en unidades menores de `currency`. */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    /** Monto convertido a la moneda del grupo, en sus unidades menores. */
    groupAmount: integer('group_amount').notNull(),
    /** Tasa decimal usada en la conversión; `1` si la moneda es la del grupo. */
    exchangeRate: text('exchange_rate').notNull().default('1'),
    /** Fecha de la tasa, `YYYY-MM-DD`. */
    rateDate: text('rate_date'),
    splitMethod: text('split_method', {
      enum: ['equal', 'exact', 'percentage', 'shares'],
    }).notNull(),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    /** Día del gasto, `YYYY-MM-DD`, sin zona horaria. */
    occurredOn: text('occurred_on').notNull(),
    notes: text('notes'),
  },
  (t) => [
    check('expenses_kind', sql`${t.kind} IN ('expense', 'income')`),
    check(
      'expenses_split_method',
      sql`${t.splitMethod} IN ('equal', 'exact', 'percentage', 'shares')`,
    ),
    check('expenses_title_length', lengthBetween(t.title, 1, 120)),
    check('expenses_amount_positive', sql`${t.amount} > 0`),
    check('expenses_group_amount_non_negative', sql`${t.groupAmount} >= 0`),
    check('expenses_currency_format', currencyCheck(t.currency)),
    check('expenses_rate_format', rateCheck(t.exchangeRate)),
    check('expenses_rate_date_format', sql`${t.rateDate} IS NULL OR ${dateCheck(t.rateDate)}`),
    check('expenses_occurred_on_format', dateCheck(t.occurredOn)),
    check('expenses_notes_length', sql`${t.notes} IS NULL OR length(${t.notes}) <= 1000`),
    check('expenses_version_positive', sql`${t.version} >= 1`),
    index('expenses_group_date_idx').on(t.groupId, t.occurredOn).where(isActive(t.deletedAt)),
    index('expenses_pending_idx').on(t.id).where(isPending(t.syncedVersion, t.version)),
  ],
);

export const expensePayers = sqliteTable(
  'expense_payers',
  {
    ...syncedColumns(),
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'restrict' }),
    memberId: text('member_id')
      .notNull()
      .references(() => groupMembers.id, { onDelete: 'restrict' }),
    /** Lo pagado en la moneda original del gasto. */
    amount: integer('amount').notNull(),
    /** Lo pagado en la moneda del grupo. */
    groupAmount: integer('group_amount').notNull(),
  },
  (t) => [
    check('expense_payers_amount_positive', sql`${t.amount} > 0`),
    check('expense_payers_group_amount_non_negative', sql`${t.groupAmount} >= 0`),
    check('expense_payers_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('expense_payers_member_unique')
      .on(t.expenseId, t.memberId)
      .where(isActive(t.deletedAt)),
    index('expense_payers_member_idx').on(t.memberId).where(isActive(t.deletedAt)),
    index('expense_payers_pending_idx').on(t.id).where(isPending(t.syncedVersion, t.version)),
  ],
);

export const expenseSplits = sqliteTable(
  'expense_splits',
  {
    ...syncedColumns(),
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'restrict' }),
    memberId: text('member_id')
      .notNull()
      .references(() => groupMembers.id, { onDelete: 'restrict' }),
    /** Parte en la moneda original del gasto. */
    amount: integer('amount').notNull(),
    /** Parte en la moneda del grupo. */
    groupAmount: integer('group_amount').notNull(),
    /**
     * Valor ingresado según el método del gasto: puntos básicos, partes o monto exacto.
     * Nulo en la división por igual. Permite editar el gasto sin perder la intención.
     */
    inputValue: integer('input_value'),
  },
  (t) => [
    check('expense_splits_amount_non_negative', sql`${t.amount} >= 0`),
    check('expense_splits_group_amount_non_negative', sql`${t.groupAmount} >= 0`),
    check('expense_splits_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('expense_splits_member_unique')
      .on(t.expenseId, t.memberId)
      .where(isActive(t.deletedAt)),
    index('expense_splits_member_idx').on(t.memberId).where(isActive(t.deletedAt)),
    index('expense_splits_pending_idx').on(t.id).where(isPending(t.syncedVersion, t.version)),
  ],
);

export const transfers = sqliteTable(
  'transfers',
  {
    ...syncedColumns(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
    /** Moneda del grupo al registrar la transferencia; ver `expenses.groupCurrency`. */
    groupCurrency: text('group_currency').notNull(),
    fromMemberId: text('from_member_id')
      .notNull()
      .references(() => groupMembers.id, { onDelete: 'restrict' }),
    toMemberId: text('to_member_id')
      .notNull()
      .references(() => groupMembers.id, { onDelete: 'restrict' }),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    groupAmount: integer('group_amount').notNull(),
    exchangeRate: text('exchange_rate').notNull().default('1'),
    rateDate: text('rate_date'),
    occurredOn: text('occurred_on').notNull(),
  },
  (t) => [
    check('transfers_distinct_members', sql`${t.fromMemberId} <> ${t.toMemberId}`),
    check('transfers_amount_positive', sql`${t.amount} > 0`),
    check('transfers_group_amount_non_negative', sql`${t.groupAmount} >= 0`),
    check('transfers_currency_format', currencyCheck(t.currency)),
    check('transfers_rate_format', rateCheck(t.exchangeRate)),
    check('transfers_rate_date_format', sql`${t.rateDate} IS NULL OR ${dateCheck(t.rateDate)}`),
    check('transfers_occurred_on_format', dateCheck(t.occurredOn)),
    check('transfers_version_positive', sql`${t.version} >= 1`),
    index('transfers_group_date_idx').on(t.groupId, t.occurredOn).where(isActive(t.deletedAt)),
    index('transfers_pending_idx').on(t.id).where(isPending(t.syncedVersion, t.version)),
  ],
);

/**
 * Datos de este dispositivo que **no se sincronizan**: el id del usuario local y los
 * borradores de formularios. Por eso no tiene las columnas de sincronización. Vive en la base
 * cifrada porque los borradores contienen montos y descripciones.
 */
export const localSettings = sqliteTable('local_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

const SYNC_ENTITIES = ['group', 'member', 'category', 'expense', 'transfer'] as const;
const CONFLICT_REASONS = [
  'conflict',
  'currency_locked',
  'group_currency_changed',
  'member_linked',
  'quota',
] as const;
/** Qué cupo del servidor se alcanzó cuando el motivo es `quota`. */
const QUOTAS = ['groups', 'members', 'categories', 'movements'] as const;
const inList = (column: AnySQLiteColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

/**
 * Envíos que ya salieron o fallaron, uno por unidad (grupo, miembro, categoría, gasto o
 * transferencia). Un envío "en vuelo" se repite con el mismo `id` y contenido hasta recibir
 * respuesta; uno "apartado" el servidor lo rechazó por inválido o prohibido y espera al usuario.
 * Datos de este dispositivo: no se sincronizan y no llevan las columnas de sincronización.
 */
export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    /** UUID del envío; el servidor lo usa para no aplicarlo dos veces. */
    id: text('id').primaryKey(),
    entity: text('entity', { enum: SYNC_ENTITIES }).notNull(),
    entityId: text('entity_id').notNull(),
    groupId: text('group_id').notNull(),
    /** Versión del servidor sobre la que se hizo el cambio; nulo si la unidad es nueva. */
    base: integer('base'),
    /** El contenido enviado, en JSON. */
    data: text('data').notNull(),
    state: text('state', { enum: ['in_flight', 'failed'] })
      .notNull()
      .default('in_flight'),
    failReason: text('fail_reason'),
    failField: text('fail_field'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('sync_outbox_entity', inList(t.entity, SYNC_ENTITIES)),
    check('sync_outbox_state', inList(t.state, ['in_flight', 'failed'])),
    check('sync_outbox_base_positive', sql`${t.base} IS NULL OR ${t.base} >= 1`),
    // Una unidad tiene a lo sumo un envío a la vez.
    uniqueIndex('sync_outbox_entity_unique').on(t.entity, t.entityId),
    index('sync_outbox_group_idx').on(t.groupId),
  ],
);

/**
 * Hasta qué `change_seq` del servidor se descargó (y aplicó) cada grupo. Datos de este dispositivo.
 *
 * Un grupo grande se baja por páginas: mientras dura, `round_seq` y `hw` (el `change_seq` más alto
 * al empezar la ronda) y `after_t`/`after_id` (dónde terminó la última página) dicen dónde seguir, y
 * las filas ya bajadas esperan en `sync_pull_pages`. Con `staged` en 1 ya llegó la última página y
 * solo falta la ronda desde `hw` para aplicarlo todo junto. `cursor` no se mueve hasta entonces.
 */
export const syncCursors = sqliteTable(
  'sync_cursors',
  {
    groupId: text('group_id').primaryKey(),
    cursor: integer('cursor').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** Límite inferior (`seq`) de la ronda en curso; nulo si es el `cursor`. */
    roundSeq: integer('round_seq'),
    hw: integer('hw'),
    afterT: integer('after_t'),
    afterId: text('after_id'),
    staged: integer('staged', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [check('sync_cursors_cursor_non_negative', sql`${t.cursor} >= 0`)],
);

/**
 * Páginas de la descarga de un grupo grande que todavía no se aplican: se juntan aquí, en la base
 * cifrada y no en memoria, hasta tener la última. Datos de este dispositivo.
 */
export const syncPullPages = sqliteTable(
  'sync_pull_pages',
  {
    groupId: text('group_id').notNull(),
    page: integer('page').notNull(),
    /** Las filas de la página, tal como llegaron (JSON). */
    rows: text('rows').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.page] })],
);

/**
 * Los enlaces de invitación que creó este teléfono, con su token, para **Compartir de nuevo**. El
 * servidor solo guarda el hash del token; el teléfono que lo creó es el único que puede volver a
 * mostrarlo. Datos de este dispositivo: no se sincronizan y viven en la base cifrada.
 */
export const invitationLinks = sqliteTable(
  'invitation_links',
  {
    /** El id de la invitación en el servidor. */
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
    token: text('token').notNull(),
    expiresAt: integer('expires_at').notNull(),
    maxUses: integer('max_uses').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('invitation_links_token_length', sql`length(${t.token}) = 43`),
    check('invitation_links_max_uses', sql`${t.maxUses} BETWEEN 1 AND 50`),
    index('invitation_links_group_idx').on(t.groupId),
  ],
);

/**
 * Cambios del usuario que el servidor rechazó por un conflicto. Nunca se pierden: quedan como
 * borrador por revisar. Datos de este dispositivo.
 */
export const syncConflicts = sqliteTable(
  'sync_conflicts',
  {
    id: text('id').primaryKey(),
    entity: text('entity', { enum: SYNC_ENTITIES }).notNull(),
    entityId: text('entity_id').notNull(),
    groupId: text('group_id').notNull(),
    reason: text('reason', { enum: CONFLICT_REASONS }).notNull(),
    /** El cupo alcanzado; solo con el motivo `quota`. */
    quota: text('quota', { enum: QUOTAS }),
    /** La versión rechazada, tal como se envió, en JSON. */
    data: text('data').notNull(),
    serverDeleted: integer('server_deleted', { mode: 'boolean' }).notNull().default(false),
    wasNew: integer('was_new', { mode: 'boolean' }).notNull().default(false),
    wasDeletion: integer('was_deletion', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('sync_conflicts_entity', inList(t.entity, SYNC_ENTITIES)),
    check('sync_conflicts_reason', inList(t.reason, CONFLICT_REASONS)),
    check('sync_conflicts_quota', sql`${t.quota} IS NULL OR ${inList(t.quota, QUOTAS)}`),
    index('sync_conflicts_group_idx').on(t.groupId),
  ],
);

export const schema = {
  users,
  groups,
  groupMembers,
  categories,
  expenses,
  expensePayers,
  expenseSplits,
  transfers,
  groupAccess,
  localSettings,
  syncOutbox,
  syncCursors,
  syncPullPages,
  syncConflicts,
  invitationLinks,
};

export type Schema = typeof schema;
