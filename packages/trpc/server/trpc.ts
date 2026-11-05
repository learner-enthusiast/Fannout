import { initTRPC, TRPCError } from "@trpc/server";
import { OpenApiMeta } from "trpc-to-openapi";
import { AppError, toTRPCError } from "@repo/errors";
import { logger } from "@repo/logger";
import { ensureUser } from "@repo/services/users";
import { createContext } from "./context";

export const tRPCContext = initTRPC
  .meta<OpenApiMeta>()
  .context<typeof createContext>()
  .create({
    errorFormatter({ shape, error }) {
      const appError = error.cause instanceof AppError ? error.cause : null;

      return {
        ...shape,
        data: {
          ...shape.data,
          appCode: appError?.code,
          details: appError?.details,
        },
      };
    },
  });

const baseProcedure = tRPCContext.procedure.use(async ({ path, type, next }) => {
  try {
    return await next();
  } catch (error) {
    logger.error("tRPC procedure failed", { path, type, error });
    throw toTRPCError(error);
  }
});

export const router = tRPCContext.router;
export const publicProcedure = baseProcedure;

export const protectedProcedure = baseProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Not authenticated",
      cause: new AppError({ code: "UNAUTHORIZED", message: "Not authenticated" }),
    });
  }

  // ctx.userId is the Clerk id; ctx.dbUserId is users.id (uuid) for service calls.
  const dbUserId = await ensureUser(ctx.userId);
  return next({ ctx: { ...ctx, userId: ctx.userId, dbUserId } });
});
