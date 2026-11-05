ALTER TABLE "users" ADD COLUMN "clerk_id" text;--> statement-breakpoint
UPDATE "users" SET "clerk_id" = "id";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "clerk_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id");--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DATA TYPE uuid USING gen_random_uuid();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
