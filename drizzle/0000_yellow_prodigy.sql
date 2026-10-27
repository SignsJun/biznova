CREATE TABLE `ad_daily` (
	`date` text NOT NULL,
	`platform` text NOT NULL,
	`spend_cents` integer NOT NULL,
	`sales_cents` integer NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	PRIMARY KEY(`date`, `platform`)
);
--> statement-breakpoint
CREATE TABLE `dataset` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_daily` (
	`date` text NOT NULL,
	`product` text NOT NULL,
	`platform` text NOT NULL,
	`revenue_cents` integer NOT NULL,
	`orders` integer NOT NULL,
	PRIMARY KEY(`date`, `product`, `platform`)
);
