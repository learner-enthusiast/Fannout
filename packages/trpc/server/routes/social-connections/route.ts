import {
  finalizeChannelSelection,
  getChannelSelection,
  getConfiguredProviders,
} from "@repo/services/oauth";
import { ChannelSelectionSchema } from "@repo/services/oauth/model";
import { PaginationInputSchema, paginatedOutput } from "@repo/services/common/pagination";
import { deactivateSocialConnection, listSocialConnectionsPage, toSocialConnectionView } from "@repo/services/social-connections";
import { SocialConnectionViewSchema } from "@repo/services/social-connections/model";
import { z } from "zod";
import { zodUndefinedModel } from "../../schema";
import { router, scoped, sessionOnlyProcedure } from "../../trpc";

const ProvidersAvailabilitySchema = z.object({
  linkedin: z.boolean().describe("LinkedIn can be connected on this server."),
  x: z.boolean().describe("X can be connected on this server."),
  youtube: z.boolean().describe("YouTube can be connected on this server."),
  facebook: z.boolean().describe("Facebook can be connected on this server."),
  threads: z.boolean().describe("Threads can be connected on this server."),
});

export const socialConnectionsRouter = router({
  /** Connected accounts, 10 at a time (newest first). */
  list: scoped("connections:read")
    .meta({ openapi: { method: "GET", path: "/social-connections", summary: "List connected social accounts", protect: true } })
    .input(PaginationInputSchema.extend({ provider: z.enum(["LINKEDIN", "X", "YOUTUBE", "FACEBOOK", "THREADS"]).optional().describe("Only accounts of this provider.") }))
    .output(paginatedOutput(SocialConnectionViewSchema))
    .query(({ ctx, input }) => listSocialConnectionsPage(ctx.dbUserId, input)),

  /** Which providers have app credentials configured (drives the connect buttons). */
  providers: scoped("connections:read")
    .meta({ openapi: { method: "GET", path: "/social-connections/providers", summary: "Which providers can be connected on this server", protect: true } })
    .input(zodUndefinedModel)
    .output(ProvidersAvailabilitySchema)
    .query(() => getConfiguredProviders()),

  /** Disconnect: marks the connection inactive and wipes its stored tokens. */
  disconnect: sessionOnlyProcedure
    .meta({ openapi: { method: "DELETE", path: "/social-connections/{id}", protect: true } })
    .input(z.object({ id: z.uuid() }))
    .output(SocialConnectionViewSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await deactivateSocialConnection(ctx.dbUserId, input.id);
      return toSocialConnectionView(row);
    }),

  channelSelection: sessionOnlyProcedure
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

  finalizeChannelSelection: sessionOnlyProcedure
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
