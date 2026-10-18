CREATE TABLE `group_access` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`invitation_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "group_access_role" CHECK("group_access"."role" IN ('owner', 'member')),
	CONSTRAINT "group_access_version_positive" CHECK("group_access"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_access_group_user_unique` ON `group_access` (`group_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `group_access_user_idx` ON `group_access` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation_links` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`max_uses` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "invitation_links_token_length" CHECK(length("invitation_links"."token") = 43),
	CONSTRAINT "invitation_links_max_uses" CHECK("invitation_links"."max_uses" BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE INDEX `invitation_links_group_idx` ON `invitation_links` (`group_id`);--> statement-breakpoint
CREATE TABLE `sync_pull_pages` (
	`group_id` text NOT NULL,
	`page` integer NOT NULL,
	`rows` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `page`)
);
--> statement-breakpoint
-- Escrito a mano sobre lo que generó drizzle-kit. `sync_conflicts` se reconstruye porque su CHECK de
-- motivos pasa a aceptar `member_linked` y `quota`, y SQLite no cambia un CHECK en su sitio. Es
-- seguro: ninguna tabla apunta a ella ni ella a otra (sin claves foráneas), así que no hay cascada
-- que pueda borrar nada. Se copian todos los borradores; `quota` queda nula. Sin PRAGMA: dentro de
-- la transacción de la migración no hacen nada.
CREATE TABLE `__new_sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`group_id` text NOT NULL,
	`reason` text NOT NULL,
	`quota` text,
	`data` text NOT NULL,
	`server_deleted` integer DEFAULT false NOT NULL,
	`was_new` integer DEFAULT false NOT NULL,
	`was_deletion` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "sync_conflicts_entity" CHECK("entity" IN ('group', 'member', 'category', 'expense', 'transfer')),
	CONSTRAINT "sync_conflicts_reason" CHECK("reason" IN ('conflict', 'currency_locked', 'group_currency_changed', 'member_linked', 'quota')),
	CONSTRAINT "sync_conflicts_quota" CHECK("quota" IS NULL OR "quota" IN ('groups', 'members', 'categories', 'movements'))
);
--> statement-breakpoint
INSERT INTO `__new_sync_conflicts`("id", "entity", "entity_id", "group_id", "reason", "data", "server_deleted", "was_new", "was_deletion", "created_at") SELECT "id", "entity", "entity_id", "group_id", "reason", "data", "server_deleted", "was_new", "was_deletion", "created_at" FROM `sync_conflicts`;--> statement-breakpoint
DROP TABLE `sync_conflicts`;--> statement-breakpoint
ALTER TABLE `__new_sync_conflicts` RENAME TO `sync_conflicts`;--> statement-breakpoint
CREATE INDEX `sync_conflicts_group_idx` ON `sync_conflicts` (`group_id`);--> statement-breakpoint
ALTER TABLE `groups` ADD `access_lost_at` integer;--> statement-breakpoint
ALTER TABLE `sync_cursors` ADD `round_seq` integer;--> statement-breakpoint
ALTER TABLE `sync_cursors` ADD `hw` integer;--> statement-breakpoint
ALTER TABLE `sync_cursors` ADD `after_t` integer;--> statement-breakpoint
ALTER TABLE `sync_cursors` ADD `after_id` text;--> statement-breakpoint
ALTER TABLE `sync_cursors` ADD `staged` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_remote` integer DEFAULT false NOT NULL;