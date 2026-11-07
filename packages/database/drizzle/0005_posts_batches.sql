ALTER TABLE "posts" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "error_message" text;--> statement-breakpoint
CREATE INDEX "posts_batch_id_idx" ON "posts" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_user_idempotency_key_unique" ON "posts" USING btree ("user_id","idempotency_key") WHERE "posts"."idempotency_key" IS NOT NULL;