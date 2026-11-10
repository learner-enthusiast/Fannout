CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "mention_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"display_name" text NOT NULL,
	"handle" text,
	"platform_ref" text,
	"avatar_url" text,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_instruction_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mention_contacts" ADD CONSTRAINT "mention_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_instruction_presets" ADD CONSTRAINT "ai_instruction_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mention_contacts_user_platform_idx" ON "mention_contacts" USING btree ("user_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "mention_contacts_user_platform_target_unique" ON "mention_contacts" USING btree ("user_id","platform",coalesce("handle", "platform_ref"));--> statement-breakpoint
CREATE INDEX "ai_instruction_presets_user_created_idx" ON "ai_instruction_presets" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mention_contacts_search_trgm_idx" ON "mention_contacts" USING gin ((display_name || ' ' || coalesce(handle, '')) gin_trgm_ops);