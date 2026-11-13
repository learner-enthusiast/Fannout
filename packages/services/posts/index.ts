import { and, asc, db, desc, eq, media, postMedia, posts, socialConnections } from "@repo/database";
import { errors } from "@repo/errors";
import { z } from "zod";
import { invalidate } from "../cache";
import {
  CreatePostInputSchema,
  ListPostsInputSchema,
  MarkPostPublishedInputSchema,
  PostRowSchema,
  PostStatusSchema,
  PostWithMediaSchema,
  UpdatePostInputSchema,
  type CreatePostInput,
  type ListPostsInput,
  type MarkPostPublishedInput,
  type PostRow,
  type PostStatus,
  type PostWithMedia,
  type UpdatePostInput,
} from "./model";

const UuidSchema = z.uuid();

async function assertSocialConnectionOwned(userId: string, socialConnectionId: string) {
  const [row] = await db
    .select({ id: socialConnections.id })
    .from(socialConnections)
    .where(and(eq(socialConnections.id, socialConnectionId), eq(socialConnections.userId, userId)))
    .limit(1);
  if (!row) errors.notFound("Social connection");
}

async function assertPostMediaBelongsToPost(postId: string, postMediaId: string) {
  const [row] = await db
    .select({ id: postMedia.id })
    .from(postMedia)
    .where(and(eq(postMedia.id, postMediaId), eq(postMedia.postId, postId)))
    .limit(1);
  if (!row) errors.notFound("Post media");
}

export async function createPost(input: CreatePostInput): Promise<PostRow> {
  const data = CreatePostInputSchema.parse(input);
  await assertSocialConnectionOwned(data.userId, data.socialConnectionId);
  const [row] = await db.insert(posts).values(data).returning();
  if (!row) return errors.internal("Failed to create post");
  await invalidate(row.userId, "posts");
  return PostRowSchema.parse(row);
}

export async function getPostById(userId: string, id: string): Promise<PostRow | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, UuidSchema.parse(id)), eq(posts.userId, UuidSchema.parse(userId))))
    .limit(1);
  return row ? PostRowSchema.parse(row) : null;
}

/** Post plus its attached media, ordered by position. */
export async function getPostWithMedia(userId: string, id: string): Promise<PostWithMedia | null> {
  const post = await getPostById(userId, id);
  if (!post) return null;

  const items = await db
    .select({
      id: postMedia.id,
      role: postMedia.role,
      position: postMedia.position,
      media,
    })
    .from(postMedia)
    .innerJoin(media, eq(postMedia.mediaId, media.id))
    .where(eq(postMedia.postId, post.id))
    .orderBy(asc(postMedia.position), asc(postMedia.createdAt));

  return PostWithMediaSchema.parse({ ...post, media: items });
}

export async function listPostsByUserId(
  userId: string,
  options: ListPostsInput = {},
): Promise<PostRow[]> {
  const { status, socialConnectionId, limit, offset } = ListPostsInputSchema.parse(options);
  const rows = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.userId, UuidSchema.parse(userId)),
        status ? eq(posts.status, status) : undefined,
        socialConnectionId ? eq(posts.socialConnectionId, socialConnectionId) : undefined,
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(limit)
    .offset(offset);
  return z.array(PostRowSchema).parse(rows);
}

export async function updatePost(
  userId: string,
  id: string,
  input: UpdatePostInput,
): Promise<PostRow> {
  const parsedUserId = UuidSchema.parse(userId);
  const parsedId = UuidSchema.parse(id);
  const data = UpdatePostInputSchema.parse(input);
  if (data.socialConnectionId) {
    await assertSocialConnectionOwned(parsedUserId, data.socialConnectionId);
  }
  if (data.postMediaId) {
    await assertPostMediaBelongsToPost(parsedId, data.postMediaId);
  }

  const [row] = await db
    .update(posts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(posts.id, parsedId), eq(posts.userId, parsedUserId)))
    .returning();
  if (!row) return errors.notFound("Post");
  await invalidate(parsedUserId, "posts");
  return PostRowSchema.parse(row);
}

export async function updatePostStatus(
  userId: string,
  id: string,
  status: PostStatus,
): Promise<PostRow> {
  return updatePost(userId, id, { status: PostStatusSchema.parse(status) });
}

export async function markPostPublished(
  userId: string,
  id: string,
  input: MarkPostPublishedInput,
): Promise<PostRow> {
  const data = MarkPostPublishedInputSchema.parse(input);
  const [row] = await db
    .update(posts)
    .set({
      status: "published",
      externalPostId: data.externalPostId,
      postUrl: data.postUrl ?? null,
      publishedAt: data.publishedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(posts.id, UuidSchema.parse(id)), eq(posts.userId, UuidSchema.parse(userId))))
    .returning();
  if (!row) return errors.notFound("Post");
  await invalidate(row.userId, "posts");
  return PostRowSchema.parse(row);
}

export async function deletePost(userId: string, id: string): Promise<void> {
  const [row] = await db
    .delete(posts)
    .where(and(eq(posts.id, UuidSchema.parse(id)), eq(posts.userId, UuidSchema.parse(userId))))
    .returning({ id: posts.id });
  if (!row) errors.notFound("Post");
  await invalidate(userId, "posts");
}
