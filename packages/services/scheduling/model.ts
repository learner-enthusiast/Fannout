import { z } from "zod";

/**
 * scheduled_posts.status
 * scheduled → (worker hand-off) handed_off → completed
 *           ↘ cancelled | missed (> 2 h late) | failed
 */
export const ScheduleStatusSchema = z
  .enum(["scheduled", "handed_off", "completed", "cancelled", "missed", "failed"])
  .describe(
    "scheduled = waiting; handed_off = upload/prepare running, final publish at scheduledAt; completed = published; cancelled; missed = the server was down > 2 h past the time (use publishNow); failed",
  );
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;

/** Validates an IANA timezone name, e.g. "Asia/Kolkata". */
export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid IANA timezone" },
  )
  .describe('IANA timezone name used to display the time, e.g. "Asia/Kolkata". Storage is always UTC.')
  .meta({ examples: ["Asia/Kolkata"] });

export const ScheduleInputSchema = z.object({
  at: z.iso
    .datetime({ offset: true })
    .describe("When to publish: ISO 8601 with offset or Z, e.g. 2026-11-07T19:00:00+05:30. Must be ≥ 2 min and ≤ 180 days from now.")
    .meta({ examples: ["2026-11-07T19:00:00+05:30"] }),
  timezone: TimezoneSchema,
});
export type ScheduleInput = z.infer<typeof ScheduleInputSchema>;

/** Publishing must be at least this far ahead (and at most MAX_SCHEDULE_DAYS). */
export const MIN_SCHEDULE_LEAD_MS = 2 * 60 * 1000;
export const MAX_SCHEDULE_DAYS = 180;
/** A job that fires later than this after scheduled_at is "missed" instead of published. */
export const MISSED_GRACE_MS = 2 * 60 * 60 * 1000;
/** handed_off this long after scheduled_at without a published post → failed. */
export const STUCK_AFTER_MS = 30 * 60 * 1000;
/** Sweeper: a scheduled row whose start_at passed this long ago lost its job. */
export const SWEEP_LATE_MS = 60 * 1000;

export const PostScheduleViewSchema = z
  .object({
    scheduledAt: z.date().describe("UTC publish time"),
    timezone: z.string().describe("IANA timezone chosen when scheduling (display only)"),
    status: ScheduleStatusSchema,
    scheduleVersion: z.number().int().positive().describe("Bumped on every reschedule / publishNow"),
    lastError: z.string().nullable().describe("Why the schedule failed or was missed"),
  })
  .describe("Present when the post was scheduled");
export type PostScheduleView = z.infer<typeof PostScheduleViewSchema>;

export const RescheduleInputSchema = z.object({
  postId: z.uuid().describe("A post whose schedule is scheduled or handed_off and that isn't published yet"),
  at: ScheduleInputSchema.shape.at,
  timezone: TimezoneSchema,
});
export type RescheduleInput = z.infer<typeof RescheduleInputSchema>;

export const ScheduleResultSchema = z.object({
  postId: z.uuid().describe("The post"),
  scheduledAt: z.date().describe("New UTC publish time"),
  timezone: z.string().describe("IANA timezone"),
  status: ScheduleStatusSchema,
  scheduleVersion: z.number().int().positive().describe("Current schedule version"),
});
export type ScheduleResult = z.infer<typeof ScheduleResultSchema>;

export const CancelScheduleResultSchema = z.object({
  postId: z.uuid().describe("The post"),
  cancelled: z.literal(true).describe("Always true: the schedule is cancelled (or already was)"),
  alreadyCancelled: z.boolean().describe("True when nothing changed (idempotent repeat, or not scheduled)"),
});
export type CancelScheduleResult = z.infer<typeof CancelScheduleResultSchema>;

export const SchedulePostIdInputSchema = z.object({ postId: z.uuid().describe("The scheduled post") });
