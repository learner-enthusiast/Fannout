import { z } from "zod";

export const ClerkUserPayloadSchema = z
  .object({
    id: z.string().min(1),
    email_addresses: z
      .array(
        z.object({
          id: z.string().min(1),
          email_address: z.email(),
        }),
      )
      .min(1),
    primary_email_address_id: z.string().min(1).nullable().optional(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    image_url: z.string().nullable(),
  })
  .superRefine((payload, ctx) => {
    if (
      payload.primary_email_address_id &&
      !payload.email_addresses.some((email) => email.id === payload.primary_email_address_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Primary email address was not present in email_addresses",
        path: ["primary_email_address_id"],
      });
    }
  });

export type ClerkUserPayload = z.infer<typeof ClerkUserPayloadSchema>;

export const UserRowSchema = z.object({
  id: z.uuid(),
  clerkId: z.string().min(1),
  email: z.email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  fullName: z.string().nullable(),
  imageUrl: z.string().nullable(),
  plan: z.string(),
  deletedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserRow = z.infer<typeof UserRowSchema>;

export const MeOutputSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string().nullable(),
  imageUrl: z.string().nullable(),
  plan: z.string(),
});
