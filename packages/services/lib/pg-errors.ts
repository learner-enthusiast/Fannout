/** Postgres error code from a driver error or drizzle's wrapped cause. */
export function pgCode(error: unknown): string | undefined {
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof cause === "string" ? cause : undefined;
}

export const isUniqueViolation = (error: unknown) => pgCode(error) === "23505";
export const isForeignKeyViolation = (error: unknown) => pgCode(error) === "23503";
