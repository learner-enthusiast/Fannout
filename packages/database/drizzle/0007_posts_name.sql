-- posts.name (required, ≤100 chars). Existing rows are backfilled from the
-- caption's first line (whitespace collapsed, cut at 100) or "Untitled post";
-- AI writes better names for new batches afterwards.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
UPDATE "posts"
SET "name" = COALESCE(
	NULLIF(left(btrim(regexp_replace(split_part(COALESCE("caption", ''), E'\n', 1), '\s+', ' ', 'g')), 100), ''),
	'Untitled post'
)
WHERE "name" IS NULL OR "name" = '';
--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "name" SET NOT NULL;
