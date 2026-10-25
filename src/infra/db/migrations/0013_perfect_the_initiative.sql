ALTER TABLE `collection` ADD `public_slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `collection_public_slug_uq` ON `collection` (`public_slug`);