CREATE TABLE "social_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"account_type" text,
	"username" text,
	"display_name" text,
	"profile_picture_url" text,
	"config" jsonb,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"access_expiry" timestamp with time zone,
	"refresh_expiry" timestamp with time zone,
	"scopes" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"original_filename" text,
	"mime_type" text NOT NULL,
	"size_bytes" bigint,
	"s3_bucket" text NOT NULL,
	"s3_key" text NOT NULL,
	"s3_region" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" numeric,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_s3_key_unique" UNIQUE("s3_key")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"social_connection_id" uuid NOT NULL,
	"caption" text,
	"config" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"external_post_id" text,
	"post_url" text,
	"post_media" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"role" text DEFAULT 'attachment' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"queue_job_id" text,
	"schedule_version" integer DEFAULT 1 NOT NULL,
	"locked_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_posts_post_id_unique" UNIQUE("post_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"code_verifier_encrypted" text NOT NULL,
	"nonce" text,
	"browser_binding_hash" text NOT NULL,
	"return_to" text NOT NULL,
	"pending_payload_encrypted" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_transactions_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_social_connection_id_social_connections_id_fk" FOREIGN KEY ("social_connection_id") REFERENCES "public"."social_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_post_media_post_media_id_fk" FOREIGN KEY ("post_media") REFERENCES "public"."post_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_transactions" ADD CONSTRAINT "oauth_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_connections_user_id_idx" ON "social_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_connections_user_provider_account_unique" ON "social_connections" USING btree ("user_id","provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "media_user_id_idx" ON "media" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "posts_user_id_idx" ON "posts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "posts_social_connection_id_idx" ON "posts" USING btree ("social_connection_id");--> statement-breakpoint
CREATE INDEX "post_media_post_id_idx" ON "post_media" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_media_media_id_idx" ON "post_media" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_media_post_media_unique" ON "post_media" USING btree ("post_id","media_id");--> statement-breakpoint
CREATE INDEX "scheduled_posts_user_id_idx" ON "scheduled_posts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scheduled_posts_status_scheduled_at_idx" ON "scheduled_posts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "oauth_transactions_user_id_idx" ON "oauth_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_transactions_expires_at_idx" ON "oauth_transactions" USING btree ("expires_at");