import { AppError, ErrorCode } from "@repo/errors";
import { logger } from "@repo/logger";
import type { ErrorRequestHandler } from "express";
import { env } from "../env";
import { loggableUrl } from "../utils/safe-url";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError =
    err instanceof AppError
      ? err
      : new AppError({
          code: ErrorCode.INTERNAL,
          message: "Something went wrong",
          cause: err,
        });

  logger.error("HTTP error", {
    path: loggableUrl(req),
    method: req.method,
    code: appError.code,
    error: appError,
  });

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(env.NODE_ENV === "development" && appError.details ? { details: appError.details } : {}),
    },
  });
};
