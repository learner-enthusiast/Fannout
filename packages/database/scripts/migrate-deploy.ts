/**
 * Applies pending SQL migrations (production / CI). Uses drizzle-orm only so
 * `drizzle-kit` does not need to be installed. Local dev can still use `db:migrate`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env } from "../env";

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

async function main() {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder });
    console.log("Database migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
