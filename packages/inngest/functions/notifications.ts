import { createNotification, pruneReadNotifications } from "@repo/services/notifications";
import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { notificationCreate } from "../events";

/**
 * notification/create → insert. The ONLY writer of the notifications table.
 * dedupe_key = event id, so retries and replays never duplicate a row.
 */
export const createNotificationFn = inngest.createFunction(
  { id: "create-notification", triggers: [notificationCreate], retries: 5 },
  async ({ event, step }) => {
    const dedupeKey = event.id;
    if (!dedupeKey) throw new NonRetriableError("Event has no id");
    const created = await step.run("insert", async () => {
      const row = await createNotification(event.data, dedupeKey);
      return row ? row.id : null;
    });
    return { notificationId: created, duplicate: created === null };
  },
);

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Daily: delete read notifications older than 90 days. */
export const pruneNotifications = inngest.createFunction(
  { id: "prune-notifications", triggers: [{ cron: "0 3 * * *" }], retries: 3 },
  async ({ step }) => {
    const deleted = await step.run("prune", () =>
      pruneReadNotifications(new Date(Date.now() - RETENTION_MS)),
    );
    return { deleted };
  },
);
