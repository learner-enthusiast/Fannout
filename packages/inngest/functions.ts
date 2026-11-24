import type { InngestFunction } from "inngest";
import { cleanupStaleUploads, deleteMediaJob, onUploadFailed, processMedia } from "./functions/media";
import { createNotificationFn, pruneNotifications } from "./functions/notifications";
import { cleanupStalePublishing, namePostBatch, publishBatch, publishPost } from "./functions/publishing";
import { generateContent } from "./functions/ai-content";
import { deletePost, editPost } from "./functions/post-actions";
import { metaDataDeletion } from "./functions/meta";
import { analyticsAccountCron, analyticsAccountSync, analyticsPostCron, analyticsPostSync } from "./functions/analytics";

/**
 * Every Inngest function served by the API. Define a function with
 * `inngest.createFunction({ id, triggers: [someEvent] }, async ({ event, step }) => …)`
 * in its own file and add it here to register it.
 */
export const functions: InngestFunction.Any[] = [
  processMedia,
  onUploadFailed,
  deleteMediaJob,
  cleanupStaleUploads,
  createNotificationFn,
  pruneNotifications,
  publishBatch,
  publishPost,
  cleanupStalePublishing,
  namePostBatch,
  generateContent,
  deletePost,
  editPost,
  analyticsAccountCron,
  analyticsPostCron,
  analyticsAccountSync,
  analyticsPostSync,
  metaDataDeletion,
];
