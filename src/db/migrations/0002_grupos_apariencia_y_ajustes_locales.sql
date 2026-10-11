-- Fase 2: apariencia y archivado de grupos, un solo "yo" por grupo y ajustes locales.
-- Solo CREATE y ADD COLUMN: no reconstruye tablas, así que no toca los datos existentes.
-- Los CHECK de `color` y `emoji` se agregaron a mano como restricciones de columna. Si se
-- declararan en schema.ts, drizzle-kit reconstruiría la tabla `groups`.
CREATE TABLE `local_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `groups` ADD `emoji` text CHECK (`emoji` IS NULL OR length(`emoji`) BETWEEN 1 AND 16);--> statement-breakpoint
ALTER TABLE `groups` ADD `color` text DEFAULT 'teal' NOT NULL CHECK (`color` IN ('teal', 'coral', 'amber', 'plum', 'sky', 'olive', 'rose', 'slate'));--> statement-breakpoint
ALTER TABLE `groups` ADD `archived_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_user_unique` ON `group_members` (`group_id`,`user_id`) WHERE "group_members"."user_id" IS NOT NULL AND "group_members"."deleted_at" IS NULL;
