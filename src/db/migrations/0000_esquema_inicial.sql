CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`group_id` text,
	`key` text,
	`name` text,
	`icon` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "categories_key_or_name" CHECK(("categories"."key" IS NULL) <> ("categories"."name" IS NULL)),
	CONSTRAINT "categories_custom_has_group" CHECK(("categories"."key" IS NULL) = ("categories"."group_id" IS NOT NULL)),
	CONSTRAINT "categories_name_length" CHECK("categories"."name" IS NULL OR length("categories"."name") BETWEEN 1 AND 40),
	CONSTRAINT "categories_version_positive" CHECK("categories"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_key_unique` ON `categories` (`key`) WHERE "categories"."key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `categories_group_idx` ON `categories` (`group_id`) WHERE "categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `expense_payers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`group_amount` integer NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`member_id`) REFERENCES `group_members`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "expense_payers_amount_positive" CHECK("expense_payers"."amount" > 0),
	CONSTRAINT "expense_payers_group_amount_non_negative" CHECK("expense_payers"."group_amount" >= 0),
	CONSTRAINT "expense_payers_version_positive" CHECK("expense_payers"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_payers_member_unique` ON `expense_payers` (`expense_id`,`member_id`) WHERE "expense_payers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `expense_payers_member_idx` ON `expense_payers` (`member_id`) WHERE "expense_payers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `expense_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`group_amount` integer NOT NULL,
	`input_value` integer,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`member_id`) REFERENCES `group_members`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "expense_splits_amount_non_negative" CHECK("expense_splits"."amount" >= 0),
	CONSTRAINT "expense_splits_group_amount_non_negative" CHECK("expense_splits"."group_amount" >= 0),
	CONSTRAINT "expense_splits_version_positive" CHECK("expense_splits"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_splits_member_unique` ON `expense_splits` (`expense_id`,`member_id`) WHERE "expense_splits"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `expense_splits_member_idx` ON `expense_splits` (`member_id`) WHERE "expense_splits"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`group_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`group_amount` integer NOT NULL,
	`exchange_rate` text DEFAULT '1' NOT NULL,
	`rate_date` text,
	`split_method` text NOT NULL,
	`category_id` text,
	`occurred_on` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "expenses_kind" CHECK("expenses"."kind" IN ('expense', 'income')),
	CONSTRAINT "expenses_split_method" CHECK("expenses"."split_method" IN ('equal', 'exact', 'percentage', 'shares')),
	CONSTRAINT "expenses_title_length" CHECK(length("expenses"."title") BETWEEN 1 AND 120),
	CONSTRAINT "expenses_amount_positive" CHECK("expenses"."amount" > 0),
	CONSTRAINT "expenses_group_amount_non_negative" CHECK("expenses"."group_amount" >= 0),
	CONSTRAINT "expenses_currency_format" CHECK("expenses"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "expenses_rate_format" CHECK("expenses"."exchange_rate" GLOB '[0-9]*' AND "expenses"."exchange_rate" NOT GLOB '*[^0-9.]*'),
	CONSTRAINT "expenses_rate_date_format" CHECK("expenses"."rate_date" IS NULL OR "expenses"."rate_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "expenses_occurred_on_format" CHECK("expenses"."occurred_on" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "expenses_notes_length" CHECK("expenses"."notes" IS NULL OR length("expenses"."notes") <= 1000),
	CONSTRAINT "expenses_version_positive" CHECK("expenses"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `expenses_group_date_idx` ON `expenses` (`group_id`,`occurred_on`) WHERE "expenses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "group_members_display_name_length" CHECK(length("group_members"."display_name") BETWEEN 1 AND 80),
	CONSTRAINT "group_members_role" CHECK("group_members"."role" IN ('owner', 'member')),
	CONSTRAINT "group_members_version_positive" CHECK("group_members"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `group_members_group_idx` ON `group_members` (`group_id`) WHERE "group_members"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "groups_name_length" CHECK(length("groups"."name") BETWEEN 1 AND 80),
	CONSTRAINT "groups_currency_format" CHECK("groups"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "groups_version_positive" CHECK("groups"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `groups_active_updated_idx` ON `groups` (`updated_at`) WHERE "groups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`group_id` text NOT NULL,
	`from_member_id` text NOT NULL,
	`to_member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`group_amount` integer NOT NULL,
	`exchange_rate` text DEFAULT '1' NOT NULL,
	`rate_date` text,
	`occurred_on` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_member_id`) REFERENCES `group_members`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_member_id`) REFERENCES `group_members`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transfers_distinct_members" CHECK("transfers"."from_member_id" <> "transfers"."to_member_id"),
	CONSTRAINT "transfers_amount_positive" CHECK("transfers"."amount" > 0),
	CONSTRAINT "transfers_group_amount_non_negative" CHECK("transfers"."group_amount" >= 0),
	CONSTRAINT "transfers_currency_format" CHECK("transfers"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "transfers_rate_format" CHECK("transfers"."exchange_rate" GLOB '[0-9]*' AND "transfers"."exchange_rate" NOT GLOB '*[^0-9.]*'),
	CONSTRAINT "transfers_rate_date_format" CHECK("transfers"."rate_date" IS NULL OR "transfers"."rate_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "transfers_occurred_on_format" CHECK("transfers"."occurred_on" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "transfers_version_positive" CHECK("transfers"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `transfers_group_date_idx` ON `transfers` (`group_id`,`occurred_on`) WHERE "transfers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	CONSTRAINT "users_display_name_length" CHECK(length("users"."display_name") BETWEEN 1 AND 80),
	CONSTRAINT "users_version_positive" CHECK("users"."version" >= 1)
);
