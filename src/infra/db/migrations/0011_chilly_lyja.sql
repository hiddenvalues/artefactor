ALTER TABLE `artefact` ADD `link_password_hash` text;--> statement-breakpoint
ALTER TABLE `artefact` ADD `link_expires_at` integer;--> statement-breakpoint
ALTER TABLE `artefact` ADD `link_gate_version` integer DEFAULT 0 NOT NULL;