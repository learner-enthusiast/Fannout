import { analyticsSyncState, db, eq } from "@repo/database";

/**
 * After OAuth reconnect, clear a stale needs_reconnect latch so the dashboard can retry sync.
 * Kept in its own leaf module (DB only) so social-connections can import it without
 * creating a cycle through analytics/sync → provider-factory → oauth → social-connections.
 */
export async function resetAnalyticsSyncAfterReconnect(connectionId: string) {
  await db
    .update(analyticsSyncState)
    .set({ status: "ok", lastError: null, updatedAt: new Date() })
    .where(eq(analyticsSyncState.socialConnectionId, connectionId));
}
