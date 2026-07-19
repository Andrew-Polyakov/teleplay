CREATE TABLE `invitation_queue_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`slot_type` text NOT NULL,
	`slot_index` integer DEFAULT 0 NOT NULL,
	`sequence_position` integer NOT NULL,
	`candidate_user_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`declared_by_user_id` integer NOT NULL,
	`invited_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`declared_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `match_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`slot_type` text NOT NULL,
	`participant_status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`overall_status` text DEFAULT 'pending' NOT NULL,
	`venue` text,
	`reminder_sent_at` integer,
	`created_by_user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`display_name` text NOT NULL,
	`first_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_user_id_unique` ON `users` (`telegram_user_id`);