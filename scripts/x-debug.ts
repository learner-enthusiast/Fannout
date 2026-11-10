/**
 * X connection diagnostics (never prints token values).
 *
 *   pnpm x:debug <connectionId>
 *
 * Prints stored OAuth scopes, token age, and GET /2/users/me (id + username).
 */
import { and, db, desc, eq, posts, socialConnections } from "../packages/database";
import { XProvider } from "../packages/providers";
import { createProviderForConnection } from "../packages/services/provider-factory";

function age(iso: Date | null | undefined): string {
  if (!iso) return "unknown";
  const ms = Date.now() - iso.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${days}d ${hours}h`;
}

async function main() {
  const connectionId = process.argv[2];
  if (!connectionId) throw new Error("Usage: pnpm x:debug <connectionId>");

  const [connection] = await db
    .select()
    .from(socialConnections)
    .where(eq(socialConnections.id, connectionId))
    .limit(1);
  if (!connection) throw new Error("Connection not found");
  if (connection.provider !== "X") throw new Error("Not an X connection");

  const required = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"] as const;
  const scopes = connection.scopes ?? [];
  const missing = required.filter((s) => !scopes.includes(s));

  console.log("--- X connection ---");
  console.log("connectionId:", connection.id);
  console.log("userId:", connection.userId);
  console.log("username:", connection.username ?? "(none)");
  console.log("isActive:", connection.isActive);
  console.log("accessExpiry:", connection.accessExpiry?.toISOString() ?? "(none)");
  console.log("connectionUpdatedAt:", connection.updatedAt.toISOString());
  console.log("tokenAge (since connection updated):", age(connection.updatedAt));
  console.log("storedScopes:", scopes.length ? scopes.join(", ") : "(none)");
  console.log("missingRequiredScopes:", missing.length ? missing.join(", ") : "none");

  const [latestFailed] = await db
    .select({
      id: posts.id,
      status: posts.status,
      errorCode: posts.errorCode,
      errorMessage: posts.errorMessage,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .where(and(eq(posts.socialConnectionId, connectionId), eq(posts.status, "failed")))
    .orderBy(desc(posts.updatedAt))
    .limit(1);

  if (latestFailed) {
    console.log("\n--- Last failed post on this connection ---");
    console.log("postId:", latestFailed.id);
    console.log("updatedAt:", latestFailed.updatedAt.toISOString());
    console.log("errorCode:", latestFailed.errorCode ?? "(none)");
    console.log("errorMessage:", latestFailed.errorMessage ?? "(none)");
  }

  try {
    const provider = await createProviderForConnection({ userId: connection.userId, connectionId });
    if (!(provider instanceof XProvider)) throw new Error("Provider is not X");
    const me = await provider.getMe({ userFields: ["profile_image_url"] });
    console.log("\n--- GET /2/users/me ---");
    console.log("id:", me.data?.id ?? "(none)");
    console.log("username:", me.data?.username ?? "(none)");
    console.log("name:", me.data?.name ?? "(none)");
  } catch (error) {
    console.log("\n--- GET /2/users/me ---");
    console.log("failed:", error instanceof Error ? error.message : String(error));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
