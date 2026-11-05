import { getUserByClerkId } from "@repo/services/users";
import { MeOutputSchema } from "@repo/services/users/model";
import { TRPCError } from "@trpc/server";
import { zodUndefinedModel } from "../../schema";
import { protectedProcedure, router } from "../../trpc";

export const usersRouter = router({
  me: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/me" } })
    .input(zodUndefinedModel)
    .output(MeOutputSchema)
    .query(async ({ ctx }) => {
      const user = await getUserByClerkId(ctx.userId);
      if (!user || user.deletedAt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        imageUrl: user.imageUrl,
        plan: user.plan,
      };
    }),
});
