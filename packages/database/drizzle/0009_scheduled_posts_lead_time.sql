ALTER TABLE "scheduled_posts" ALTER COLUMN "status" SET DEFAULT 'scheduled';--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
UPDATE "scheduled_posts" SET "start_at" = "scheduled_at" WHERE "start_at" IS NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ALTER COLUMN "start_at" SET NOT NULL;--> statement-breakpoint
UPDATE "scheduled_posts" SET "status" = CASE "status" WHEN 'pending' THEN 'scheduled' WHEN 'queued' THEN 'scheduled' WHEN 'processing' THEN 'handed_off' ELSE "status" END;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "missed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE INDEX "scheduled_posts_status_start_at_idx" ON "scheduled_posts" USING btree ("status","start_at");
