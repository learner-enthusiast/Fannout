import { MAX_SCHEDULE_DAYS, MIN_SCHEDULE_LEAD_MS, type ScheduleInput } from "./model";

export type EffectiveSchedule = { at: Date; timezone: string };

/**
 * Per-card time wins; "Schedule all" fills only cards without one; neither =
 * publish now (null).
 */
export function effectiveSchedule(
  target: { schedule?: ScheduleInput | null },
  scheduleAll: ScheduleInput | null | undefined,
): EffectiveSchedule | null {
  const chosen = target.schedule ?? scheduleAll ?? null;
  return chosen ? { at: new Date(chosen.at), timezone: chosen.timezone } : null;
}

/** null when OK, else a user-facing message. */
export function scheduleTimeIssue(at: Date, now: Date = new Date()): string | null {
  if (Number.isNaN(at.getTime())) return "Pick a valid date and time";
  if (at.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) return "Schedule at least 2 minutes from now";
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
    return `Schedule at most ${MAX_SCHEDULE_DAYS} days ahead`;
  }
  return null;
}
