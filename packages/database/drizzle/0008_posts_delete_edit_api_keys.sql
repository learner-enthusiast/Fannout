CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "delete_error_code" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "delete_error_message" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "external_status" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "edit_status" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "last_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "edit_error_code" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "edit_error_message" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "revisions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");