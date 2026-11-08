import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "./env";

export const db = drizzle(env.DATABASE_URL);
export * from "./schema";
export * from "drizzle-orm";
export default db;

/** Round-trips `select 1` through the pool. Throws if Postgres is unreachable. */
export async function checkDatabaseConnection(): Promise<void> {
  await db.$client.query("select 1");
}

/** Close the pool (graceful shutdown). */
export async function closeDatabase(): Promise<void> {
  await db.$client.end();
}
