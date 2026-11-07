-- Named media + folders. Replaces media_thumbnails (data is migrated first).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- 1. media.name — backfilled from original_filename without its extension.
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
UPDATE "media"
SET "name" = COALESCE(NULLIF(regexp_replace(COALESCE("original_filename", ''), '\.[^./\\]*$', ''), ''), 'Untitled')
WHERE "name" IS NULL;
--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "name" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_user_type_created_idx" ON "media" USING btree ("user_id","type","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_name_trgm_idx" ON "media" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint

-- 2. media_folders
CREATE TABLE IF NOT EXISTS "media_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cover_media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "media_folders_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_folders_user_name_unique" ON "media_folders" USING btree ("user_id",lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_folders_name_trgm_idx" ON "media_folders" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_folders_user_created_idx" ON "media_folders" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint

-- 3. media_folder_items
CREATE TABLE IF NOT EXISTS "media_folder_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"role" text NOT NULL,
	"label" text,
	"position" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_folder_items_folder_id_media_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "media_folder_items_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_folder_items_folder_media_unique" ON "media_folder_items" USING btree ("folder_id","media_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_folder_items_one_primary_per_role" ON "media_folder_items" USING btree ("folder_id","role") WHERE "media_folder_items"."is_primary";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_folder_items_media_id_idx" ON "media_folder_items" USING btree ("media_id");
--> statement-breakpoint

-- 4. Data migration (idempotent): every video with thumbnails becomes a folder
--    named after the video (" (2)", " (3)"… on clashes) holding the video as
--    main_landscape / main_portrait and its images as thumbnails (position and
--    primary kept). A video already placed as main_* in a folder is skipped.
DO $$
DECLARE
	v record;
	candidate text;
	n integer;
	folder uuid;
BEGIN
	IF to_regclass('public.media_thumbnails') IS NULL THEN
		RETURN;
	END IF;

	FOR v IN
		SELECT DISTINCT m.id, m.user_id, m.name, m.width, m.height, m.created_at
		FROM "media" m
		JOIN "media_thumbnails" t ON t.video_media_id = m.id
		ORDER BY m.created_at, m.id
	LOOP
		IF EXISTS (
			SELECT 1 FROM "media_folder_items" i
			JOIN "media_folders" f ON f.id = i.folder_id
			WHERE i.media_id = v.id AND f.user_id = v.user_id
				AND i.role IN ('main_landscape', 'main_portrait')
		) THEN
			CONTINUE;
		END IF;

		candidate := v.name;
		n := 1;
		WHILE EXISTS (
			SELECT 1 FROM "media_folders" WHERE user_id = v.user_id AND lower(name) = lower(candidate)
		) LOOP
			n := n + 1;
			candidate := v.name || ' (' || n || ')';
		END LOOP;

		INSERT INTO "media_folders" (user_id, name, cover_media_id)
		VALUES (
			v.user_id,
			candidate,
			(SELECT image_media_id FROM "media_thumbnails" WHERE video_media_id = v.id AND is_primary LIMIT 1)
		)
		RETURNING id INTO folder;

		INSERT INTO "media_folder_items" (folder_id, media_id, role, position, is_primary)
		VALUES (
			folder,
			v.id,
			CASE WHEN COALESCE(v.height, 0) > COALESCE(v.width, 0) THEN 'main_portrait' ELSE 'main_landscape' END,
			0,
			true
		);

		INSERT INTO "media_folder_items" (folder_id, media_id, role, position, is_primary)
		SELECT folder, t.image_media_id, 'thumbnail', t.position, t.is_primary
		FROM "media_thumbnails" t
		WHERE t.video_media_id = v.id
		ORDER BY t.position
		ON CONFLICT (folder_id, media_id) DO NOTHING;
	END LOOP;
END $$;
--> statement-breakpoint

-- 5. Drop the old table.
DROP TABLE IF EXISTS "media_thumbnails" CASCADE;
