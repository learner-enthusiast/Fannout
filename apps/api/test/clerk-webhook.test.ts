import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { verifyWebhook } from "@clerk/express/webhooks";
import { after, before, test } from "node:test";
import { createClerkWebhookHandler } from "../src/webhooks/clerk";

const signingSecret = `whsec_${Buffer.from(randomUUID()).toString("base64")}`;
const writtenUsers = new Map<string, string>();
const app = express();

app.post(
  "/webhooks/clerk",
  express.raw({ type: "application/json" }),
  createClerkWebhookHandler({
    verify: (request) => verifyWebhook(request, { signingSecret }),
    upsertUser: async (user) => {
      const emailId = user.primary_email_address_id;
      const email =
        user.email_addresses.find(({ id }) => id === emailId) ?? user.email_addresses[0];
      if (!email) throw new Error("Test webhook user is missing an email");
      writtenUsers.set(user.id, email.email_address);
      return {
        id: user.id,
        email: email.email_address,
        firstName: user.first_name,
        lastName: user.last_name,
        fullName: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
        imageUrl: user.image_url,
        plan: "free",
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    softDeleteUser: async (id) => {
      writtenUsers.delete(id);
    },
  }),
);

const server = app.listen(0);
let port: number;

before(async () => {
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  port = address.port;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function signedHeaders(body: string, secret: string) {
  const id = `msg_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");

  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

const clerkUser = {
  id: `user_${randomUUID()}`,
  email_addresses: [{ id: "email_primary", email_address: "clerk-test@example.com" }],
  primary_email_address_id: "email_primary",
  first_name: "Test",
  last_name: "User",
  image_url: "https://example.com/avatar.png",
};

test("valid Clerk signature returns 200 and writes the user", async () => {
  const body = JSON.stringify({
    type: "user.created",
    data: clerkUser,
    object: "event",
    timestamp: Date.now(),
    instance_id: "ins_test",
  });
  const response = await fetch(`http://localhost:${port}/webhooks/clerk`, {
    method: "POST",
    headers: signedHeaders(body, signingSecret),
    body,
  });

  assert.equal(response.status, 200);
  assert.equal(writtenUsers.get(clerkUser.id), "clerk-test@example.com");
});

test("invalid Clerk signature returns 400 and does not write the user", async () => {
  const invalidUser = { ...clerkUser, id: `user_${randomUUID()}` };
  const body = JSON.stringify({
    type: "user.created",
    data: invalidUser,
    object: "event",
    timestamp: Date.now(),
    instance_id: "ins_test",
  });
  const response = await fetch(`http://localhost:${port}/webhooks/clerk`, {
    method: "POST",
    headers: signedHeaders(body, `whsec_${Buffer.from(randomUUID()).toString("base64")}`),
    body,
  });

  assert.equal(response.status, 400);
  assert.equal(writtenUsers.has(invalidUser.id), false);
});
