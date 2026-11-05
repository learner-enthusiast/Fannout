import type { Request, Response } from "express";
import { verifyWebhook, type WebhookEvent } from "@clerk/express/webhooks";
import { ClerkUserPayloadSchema } from "@repo/services/users/model";
import { softDeleteUser, upsertUserFromClerk } from "@repo/services/users";

type ClerkWebhookDependencies = {
  verify: (request: Request) => Promise<WebhookEvent>;
  upsertUser: typeof upsertUserFromClerk;
  softDeleteUser: typeof softDeleteUser;
};

const defaultDependencies: ClerkWebhookDependencies = {
  verify: (request) => verifyWebhook(request),
  upsertUser: upsertUserFromClerk,
  softDeleteUser,
};

export function createClerkWebhookHandler(
  dependencies: ClerkWebhookDependencies = defaultDependencies,
) {
  return async (request: Request, response: Response) => {
    let event: WebhookEvent;
    try {
      event = await dependencies.verify(request);
    } catch {
      return response.status(400).send("Invalid Clerk webhook signature");
    }

    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const user = ClerkUserPayloadSchema.safeParse(event.data);
        if (!user.success) {
          return response.status(400).send("Invalid Clerk user payload");
        }

        await dependencies.upsertUser(user.data);
        break;
      }
      case "user.deleted": {
        const user = ClerkUserPayloadSchema.shape.id.safeParse(event.data.id);
        if (!user.success) {
          return response.status(400).send("Invalid Clerk user payload");
        }

        await dependencies.softDeleteUser(user.data);
        break;
      }
    }

    return response.status(200).send("OK");
  };
}

export const clerkWebhookHandler = createClerkWebhookHandler();
