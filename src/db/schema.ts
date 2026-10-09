import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

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

const isActive = (deletedAt: AnySQLiteColumn): SQL => sql`${deletedAt} IS NULL`;
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
  },
  (t) => [
    check('users_display_name_length', lengthBetween(t.displayName, 1, 80)),
    check('users_version_positive', sql`${t.version} >= 1`),
  ],
);

export const groups = sqliteTable(
  'groups',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check('groups_name_length', lengthBetween(t.name, 1, 80)),
    check('groups_currency_format', currencyCheck(t.currency)),
    check('groups_version_positive', sql`${t.version} >= 1`),
    index('groups_active_updated_idx').on(t.updatedAt).where(isActive(t.deletedAt)),
  ],
);

export const groupMembers = sqliteTable(
  'group_members',
  {
    ...syncColumns(),
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
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    ...syncColumns(),
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
  ],
);

export const expenses = sqliteTable(
  'expenses',
  {
    ...syncColumns(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
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
  ],
);

export const expensePayers = sqliteTable(
  'expense_payers',
  {
    ...syncColumns(),
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
  ],
);

export const expenseSplits = sqliteTable(
  'expense_splits',
  {
    ...syncColumns(),
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
  ],
);

export const transfers = sqliteTable(
  'transfers',
  {
    ...syncColumns(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
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
};

export type Schema = typeof schema;
