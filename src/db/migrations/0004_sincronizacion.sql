CREATE TABLE `sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`group_id` text NOT NULL,
	`reason` text NOT NULL,
	`data` text NOT NULL,
	`server_deleted` integer DEFAULT false NOT NULL,
	`was_new` integer DEFAULT false NOT NULL,
	`was_deletion` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "sync_conflicts_entity" CHECK("sync_conflicts"."entity" IN ('group', 'member', 'category', 'expense', 'transfer')),
	CONSTRAINT "sync_conflicts_reason" CHECK("sync_conflicts"."reason" IN ('conflict', 'currency_locked', 'group_currency_changed'))
);
--> statement-breakpoint
CREATE INDEX `sync_conflicts_group_idx` ON `sync_conflicts` (`group_id`);--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`group_id` text PRIMARY KEY NOT NULL,
	`cursor` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "sync_cursors_cursor_non_negative" CHECK("sync_cursors"."cursor" >= 0)
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`group_id` text NOT NULL,
	`base` integer,
	`data` text NOT NULL,
	`state` text DEFAULT 'in_flight' NOT NULL,
	`fail_reason` text,
	`fail_field` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "sync_outbox_entity" CHECK("sync_outbox"."entity" IN ('group', 'member', 'category', 'expense', 'transfer')),
	CONSTRAINT "sync_outbox_state" CHECK("sync_outbox"."state" IN ('in_flight', 'failed')),
	CONSTRAINT "sync_outbox_base_positive" CHECK("sync_outbox"."base" IS NULL OR "sync_outbox"."base" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_outbox_entity_unique` ON `sync_outbox` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `sync_outbox_group_idx` ON `sync_outbox` (`group_id`);--> statement-breakpoint
ALTER TABLE `categories` ADD `server_version` integer;--> statement-breakpoint
ALTER TABLE `categories` ADD `synced_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `categories_pending_idx` ON `categories` (`id`) WHERE "categories"."synced_version" <> "categories"."version";--> statement-breakpoint
ALTER TABLE `expense_payers` ADD `server_version` integer;--> statement-breakpoint
ALTER TABLE `expense_payers` ADD `synced_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `expense_payers_pending_idx` ON `expense_payers` (`id`) WHERE "expense_payers"."synced_version" <> "expense_payers"."version";--> statement-breakpoint
ALTER TABLE `expense_splits` ADD `server_version` integer;--> statement-breakpoint
ALTER TABLE `expense_splits` ADD `synced_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `expense_splits_pending_idx` ON `expense_splits` (`id`) WHERE "expense_splits"."synced_version" <> "expense_splits"."version";--> statement-breakpoint
ALTER TABLE `expenses` ADD `server_version` integer;--> statement-breakpoint
ALTER TABLE `expenses` ADD `synced_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Escrito a mano: SQLite exige un DEFAULT para agregar una columna NOT NULL y el CHECK de formato
-- va como restricción de columna (como en la 0002), para que ninguna tabla se reconstruya. Todas
-- las filas se rellenan abajo con la moneda de su grupo; el código siempre manda el valor.
ALTER TABLE `expenses` ADD `group_currency` text DEFAULT 'USD' NOT NULL CHECK (`group_currency` GLOB '[A-Z][A-Z][A-Z]');--> statement-breakpoint
CREATE INDEX `expenses_pending_idx` ON `expenses` (`id`) WHERE "expenses"."synced_version" <> "expenses"."version";--> statement-breakpoint
ALTER TABLE `group_members` ADD `server_version` integer;--> statement-breakpoint
ALTER TABLE `group_members` ADD `synced_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `group_members_pending_idx` ON `group_members` (`id`) WHERE "group_members"."synced_version" <> "group_members"."version";--> statement-breakpoint
ALTER TABLE `groups` ADD `server_version` integer;--> statement-breakpoint
ALTER TABLE `groups` ADD `synced_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `groups_pending_idx` ON `groups` (`id`) WHERE "groups"."synced_version" <> "groups"."version";--> statement-breakpoint
ALTER TABLE `transfers` ADD `server_version` integer;--> statement-breakpoint
ALTER TABLE `transfers` ADD `synced_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transfers` ADD `group_currency` text DEFAULT 'USD' NOT NULL CHECK (`group_currency` GLOB '[A-Z][A-Z][A-Z]');--> statement-breakpoint
CREATE INDEX `transfers_pending_idx` ON `transfers` (`id`) WHERE "transfers"."synced_version" <> "transfers"."version";--> statement-breakpoint
-- Relleno (también a mano). Cada movimiento recibe la moneda de su grupo; los borrados también.
UPDATE `expenses` SET `group_currency` = (SELECT `currency` FROM `groups` WHERE `groups`.`id` = `expenses`.`group_id`);--> statement-breakpoint
UPDATE `transfers` SET `group_currency` = (SELECT `currency` FROM `groups` WHERE `groups`.`id` = `transfers`.`group_id`);--> statement-breakpoint
-- Las 9 predefinidas viajan en la app y nunca se envían: quedan al día. Todo lo demás, con
-- `synced_version` en 0 y `version` desde 1, queda pendiente de subir.
UPDATE `categories` SET `synced_version` = `version` WHERE `key` IS NOT NULL;