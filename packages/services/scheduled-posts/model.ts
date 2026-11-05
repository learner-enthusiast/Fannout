import { z } from "zod";

export const ScheduledPostStatusSchema = z.enum([
  "pending",
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export type ScheduledPostStatus = z.infer<typeof ScheduledPostStatusSchema>;

/** Validates an IANA timezone name, e.g. "Asia/Kolkata". */
export const TimezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid IANA timezone" },
);

export const ScheduledPostRowSchema = z.object({
  id: z.uuid(),
  postId: z.uuid(),
  userId: z.uuid(),
  scheduledAt: z.date(),
  timezone: z.string(),
  status: ScheduledPostStatusSchema,
  queueJobId: z.string().nullable(),
  scheduleVersion: z.number().int().positive(),
  lockedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ScheduledPostRow = z.infer<typeof ScheduledPostRowSchema>;

export const CreateScheduledPostInputSchema = z.object({
  postId: z.uuid(),
  scheduledAt: z.coerce.date(),
  timezone: TimezoneSchema,
});

export type CreateScheduledPostInput = z.input<typeof CreateScheduledPostInputSchema>;

export const RescheduleInputSchema = z.object({
  scheduledAt: z.coerce.date(),
  timezone: TimezoneSchema.optional(),
});

export type RescheduleInput = z.input<typeof RescheduleInputSchema>;

export const ListScheduledPostsInputSchema = z.object({
  status: ScheduledPostStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type ListScheduledPostsInput = z.input<typeof ListScheduledPostsInputSchema>;

export const ListDueScheduledPostsInputSchema = z.object({
  now: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type ListDueScheduledPostsInput = z.input<typeof ListDueScheduledPostsInputSchema>;
