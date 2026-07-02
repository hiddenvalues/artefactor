CREATE TABLE `artefact_bookmark` (
	`user_id` text NOT NULL,
	`artefact_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `artefact_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artefact_id`) REFERENCES `artefact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artefact_bookmark_artefact_idx` ON `artefact_bookmark` (`artefact_id`);--> statement-breakpoint
CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`root_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_owner_idx` ON `collection` (`owner_id`);--> statement-breakpoint
CREATE INDEX `collection_parent_idx` ON `collection` (`parent_id`);--> statement-breakpoint
CREATE INDEX `collection_root_idx` ON `collection` (`root_id`);--> statement-breakpoint
CREATE TABLE `collection_access` (
	`collection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `user_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_access_user_idx` ON `collection_access` (`user_id`);--> statement-breakpoint
CREATE TABLE `collection_bookmark` (
	`user_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `collection_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_bookmark_collection_idx` ON `collection_bookmark` (`collection_id`);--> statement-breakpoint
ALTER TABLE `artefact` ADD `collection_id` text REFERENCES collection(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `artefact_collection_idx` ON `artefact` (`collection_id`);