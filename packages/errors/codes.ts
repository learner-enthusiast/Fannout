// packages/errors/codes.ts
export const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION: "VALIDATION",
  BAD_REQUEST: "BAD_REQUEST",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  /** Delete blocked: still used by unpublished posts (details.posts). */
  MEDIA_IN_USE: "MEDIA_IN_USE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function statusFromCode(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.UNAUTHORIZED:
      return 401;
    case ErrorCode.FORBIDDEN:
      return 403;
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.CONFLICT:
    case ErrorCode.MEDIA_IN_USE:
      return 409;
    case ErrorCode.VALIDATION:
    case ErrorCode.BAD_REQUEST:
      return 400;
    case ErrorCode.TOO_MANY_REQUESTS:
      return 429;
    case ErrorCode.INTERNAL:
    default:
      return 500;
  }
}
