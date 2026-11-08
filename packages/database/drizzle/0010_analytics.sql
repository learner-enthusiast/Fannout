CREATE TABLE "analytics_account_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"social_connection_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_post_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"social_connection_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_sync_state" (
	"social_connection_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_account_sync_at" timestamp with time zone,
	"last_post_sync_at" timestamp with time zone,
	"last_error" text,
	"next_sync_at" timestamp with time zone,
	"last_manual_refresh_at" timestamp with time zone,
	"backfilled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_account_daily" ADD CONSTRAINT "analytics_account_daily_social_connection_id_social_connections_id_fk" FOREIGN KEY ("social_connection_id") REFERENCES "public"."social_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_post_snapshots" ADD CONSTRAINT "analytics_post_snapshots_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_post_snapshots" ADD CONSTRAINT "analytics_post_snapshots_social_connection_id_social_connections_id_fk" FOREIGN KEY ("social_connection_id") REFERENCES "public"."social_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sync_state" ADD CONSTRAINT "analytics_sync_state_social_connection_id_social_connections_id_fk" FOREIGN KEY ("social_connection_id") REFERENCES "public"."social_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_account_daily_connection_date_unique" ON "analytics_account_daily" USING btree ("social_connection_id","date");--> statement-breakpoint
CREATE INDEX "analytics_post_snapshots_post_captured_idx" ON "analytics_post_snapshots" USING btree ("post_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_post_snapshots_connection_idx" ON "analytics_post_snapshots" USING btree ("social_connection_id");--> statement-breakpoint
CREATE INDEX "analytics_sync_state_status_idx" ON "analytics_sync_state" USING btree ("status") WHERE "analytics_sync_state"."status" <> 'ok';