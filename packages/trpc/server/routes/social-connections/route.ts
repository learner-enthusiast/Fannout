import {
  finalizeChannelSelection,
  getChannelSelection,
  getConfiguredProviders,
} from "@repo/services/oauth";
import { ChannelSelectionSchema } from "@repo/services/oauth/model";
import {
  deactivateSocialConnection,
  listSocialConnectionsByUserId,
  toSocialConnectionView,
} from "@repo/services/social-connections";
import { SocialConnectionViewSchema } from "@repo/services/social-connections/model";
import { z } from "zod";
import { zodUndefinedModel } from "../../schema";
import { protectedProcedure, router } from "../../trpc";

const ProvidersAvailabilitySchema = z.object({
  linkedin: z.boolean(),
  x: z.boolean(),
  youtube: z.boolean(),
  facebook: z.boolean(),
  threads: z.boolean(),
});

export const socialConnectionsRouter = router({
  list: protectedProcedure
    .meta({ openapi: { method: "GET", path: "/social-connections", protect: true } })
    .input(zodUndefinedModel)
    .output(
      z.object({
        connections: z.array(SocialConnectionViewSchema),
        providers: ProvidersAvailabilitySchema,
      }),
    )
    .query(async ({ ctx }) => {
      const rows = await listSocialConnectionsByUserId(ctx.dbUserId, { limit: 100 });
      const now = new Date();
      return {
        connections: rows.map((row) => toSocialConnectionView(row, now)),
        providers: getConfiguredProviders(),
      };
    }),

  /** Disconnect: marks the connection inactive and wipes its stored tokens. */
  disconnect: protectedProcedure
    .meta({ openapi: { method: "DELETE", path: "/social-connections/{id}", protect: true } })
    .input(z.object({ id: z.uuid() }))
    .output(SocialConnectionViewSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await deactivateSocialConnection(ctx.dbUserId, input.id);
      return toSocialConnectionView(row);
    }),

  channelSelection: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/social-connections/channel-selections/{id}",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(ChannelSelectionSchema)
    .query(({ ctx, input }) => getChannelSelection(ctx.dbUserId, input.id)),

  finalizeChannelSelection: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/social-connections/channel-selections/{id}",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), channelIds: z.array(z.string().min(1)).min(1).max(50) }))
    .output(z.object({ connectionIds: z.array(z.uuid()) }))
    .mutation(({ ctx, input }) =>
      finalizeChannelSelection(ctx.dbUserId, {
        selectionId: input.id,
        channelIds: input.channelIds,
      }),
    ),
});
