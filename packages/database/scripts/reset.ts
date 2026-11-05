/**
 * Wipes the database: drops the `public` schema (all app tables) and the
 * `drizzle` schema (migration history). Run `db:migrate` afterwards — the
 * `db:reset` script does both.
 *
 * Refuses to run when NODE_ENV=prod, the URL doesn't look local, or the
 * database holds tables this repo doesn't define, unless --force is passed.
 */
import { getTableName, isTable } from "drizzle-orm";
import pg from "pg";
import { env } from "../env";
import * as schema from "../schema";

async function main() {
  const force = process.argv.includes("--force");
  const url = new URL(env.DATABASE_URL);
  const isLocal = ["localhost", "127.0.0.1", "::1", "postgresdb"].includes(url.hostname);

  if (!force && (process.env.NODE_ENV === "prod" || !isLocal)) {
    console.error(
      `Refusing to reset ${url.hostname}/${url.pathname.slice(1)} (NODE_ENV=${process.env.NODE_ENV ?? "unset"}). ` +
        "Pass --force if you really mean it.",
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    // Guard against pointing at another project's database by mistake.
    const ours = new Set<string>(
      Object.values(schema)
        .filter(isTable)
        .map((table) => getTableName(table)),
    );
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const foreign = rows.map((row) => row.tablename).filter((name) => !ours.has(name));
    if (foreign.length > 0 && !force) {
      console.error(
        `Refusing to reset ${url.pathname.slice(1)}: it has tables this repo doesn't define ` +
          `(${foreign.join(", ")}). Check DATABASE_URL, or pass --force.`,
      );
      process.exitCode = 1;
      return;
    }

    await client.query(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO public;
    `);
    console.log(
      `Reset ${url.hostname}/${url.pathname.slice(1)}: dropped all tables and migration history.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: Error) => {
  console.error("Database reset failed:", error.message);
  process.exit(1);
});
