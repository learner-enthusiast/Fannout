import { TRPCError } from "@trpc/server";
import { AppError } from "./app-error";
import { ErrorCode } from "./codes";

const trpcCodeMap: Record<ErrorCode, TRPCError["code"]> = {
  [ErrorCode.UNAUTHORIZED]: "UNAUTHORIZED",
  [ErrorCode.FORBIDDEN]: "FORBIDDEN",
  [ErrorCode.NOT_FOUND]: "NOT_FOUND",
  [ErrorCode.CONFLICT]: "CONFLICT",
  [ErrorCode.VALIDATION]: "BAD_REQUEST",
  [ErrorCode.BAD_REQUEST]: "BAD_REQUEST",
  [ErrorCode.TOO_MANY_REQUESTS]: "TOO_MANY_REQUESTS",
  [ErrorCode.MEDIA_IN_USE]: "CONFLICT",
  [ErrorCode.INTERNAL]: "INTERNAL_SERVER_ERROR",
};

export function toTRPCError(error: unknown): TRPCError {
  if (error instanceof AppError) {
    return new TRPCError({
      code: trpcCodeMap[error.code],
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof TRPCError) return error;

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong",
    cause: error,
  });
}
