import { z } from "zod";

export const MediaTypeSchema = z.enum(["image", "video"]);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const MediaStatusSchema = z.enum(["pending", "uploaded", "processing", "ready", "failed"]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const MediaRowSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  type: MediaTypeSchema,
  status: MediaStatusSchema,
  originalFilename: z.string().nullable(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().nullable(),
  s3Bucket: z.string().min(1),
  s3Key: z.string().min(1),
  s3Region: z.string().min(1),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MediaRow = z.infer<typeof MediaRowSchema>;

export const CreateMediaInputSchema = z.object({
  userId: z.uuid(),
  type: MediaTypeSchema,
  status: MediaStatusSchema.optional(),
  originalFilename: z.string().nullable().optional(),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  s3Bucket: z.string().min(1),
  s3Key: z.string().min(1),
  s3Region: z.string().min(1),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type CreateMediaInput = z.input<typeof CreateMediaInputSchema>;

export const UpdateMediaInputSchema = CreateMediaInputSchema.omit({
  userId: true,
  s3Bucket: true,
  s3Key: true,
  s3Region: true,
}).partial();

export type UpdateMediaInput = z.input<typeof UpdateMediaInputSchema>;

export const ListMediaInputSchema = z.object({
  type: MediaTypeSchema.optional(),
  status: MediaStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type ListMediaInput = z.input<typeof ListMediaInputSchema>;
