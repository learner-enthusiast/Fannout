import { errors } from "@repo/errors";
import type { ComposeCapabilities } from "@repo/providers";
import type { z } from "zod";
import { omit } from "../lib/omit";
import type { FieldIssue } from "./model";

/**
 * Pure decisions for delete/edit (unit-tested). The DB layer loads the post,
 * capabilities and connection, then applies what these return.
 */

export type DeletePlan =
  | { kind: "cancel" }
  | { kind: "queue" }
  | { kind: "manual"; deleteNote: string }
  | { kind: "noop" }
  | { kind: "reconnect_for_delete" };

/** By status: not published → cancel; published → queue (or manual); done → noop. */
export function planDelete(params: {
  status: string;
  platform: string;
  capabilities: Pick<ComposeCapabilities, "supportsDelete" | "deleteNote">;
  connectionScopes: string[] | null;
}): DeletePlan {
  const { status, platform, capabilities, connectionScopes } = params;
  if (["deleting", "deleted", "cancelled"].includes(status)) return { kind: "noop" };
  if (["queued", "publishing", "scheduled", "draft", "failed"].includes(status)) return { kind: "cancel" };
  if (status !== "published") return { kind: "noop" };
  if (!capabilities.supportsDelete) return { kind: "manual", deleteNote: capabilities.deleteNote };
  // Threads needs threads_delete; older connections didn't ask for it.
  if (platform === "threads" && connectionScopes && !connectionScopes.includes("threads_delete")) {
    return { kind: "reconnect_for_delete" };
  }
  return { kind: "queue" };
}

export type EditPlan = { kind: "noop" } | { kind: "queue"; merged: Record<string, unknown>; changed: Record<string, unknown>; before: Record<string, unknown> };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Only editableFields may change; the merged input must pass the platform's
 * compose schema. Throws VALIDATION with per-field issues.
 */
export function planEdit(params: {
  status: string;
  externalStatus: string;
  editStatus: string | null;
  capabilities: Pick<ComposeCapabilities, "supportsEdit" | "editableFields" | "editNote">;
  schema: z.ZodObject;
  current: Record<string, unknown>;
  changes: Record<string, unknown>;
}): EditPlan {
  const { capabilities, schema, current, changes } = params;
  if (params.editStatus === "editing") return { kind: "noop" };
  if (params.status !== "published" || params.externalStatus !== "live") {
    return errors.conflict("Only live published posts can be edited");
  }
  if (!capabilities.supportsEdit) return errors.validation(capabilities.editNote, { issues: [] });

  const issues: FieldIssue[] = [];
  for (const field of Object.keys(changes)) {
    if (!capabilities.editableFields.includes(field)) issues.push({ field, message: `${field} can't be edited after publishing` });
  }
  if (issues.length) return errors.validation("Some fields can't be edited", { issues });

  const changed = Object.fromEntries(Object.entries(changes).filter(([field, value]) => !same(current[field], value)));
  if (Object.keys(changed).length === 0) return { kind: "noop" };

  const inputChanges = omit(changed, "thumbnail");
  const merged = { ...current, ...inputChanges };
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    return errors.validation("Some values aren't valid", {
      issues: parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? "input"), message: i.message })),
    });
  }
  const before = Object.fromEntries(Object.keys(changed).map((field) => [field, current[field] ?? null]));
  return { kind: "queue", merged: { ...(parsed.data as Record<string, unknown>), ...("thumbnail" in changed ? { thumbnail: changed.thumbnail } : {}) }, changed, before };
}

/**
 * YouTube videos.update overwrites every mutable field of the parts sent and
 * deletes omitted ones, so resend the FULL snippet (title, description, tags,
 * categoryId — keeping fields we don't manage from the live video) and status.
 */
export function buildYouTubeUpdate(
  videoId: string,
  live: { snippet?: Record<string, unknown> | null; status?: Record<string, unknown> | null },
  merged: { title: string; description?: string; tags?: string[]; categoryId?: string; privacyStatus: string; madeForKids: boolean },
) {
  const snippet = live.snippet ?? {};
  const status = live.status ?? {};
  return {
    id: videoId,
    snippet: {
      title: merged.title,
      description: merged.description ?? "",
      tags: merged.tags ?? [],
      categoryId: merged.categoryId ?? (snippet.categoryId as string | undefined) ?? "22",
      ...(typeof snippet.defaultLanguage === "string" ? { defaultLanguage: snippet.defaultLanguage } : {}),
      ...(typeof snippet.defaultAudioLanguage === "string" ? { defaultAudioLanguage: snippet.defaultAudioLanguage } : {}),
    },
    status: {
      privacyStatus: merged.privacyStatus,
      selfDeclaredMadeForKids: merged.madeForKids,
      ...(typeof status.embeddable === "boolean" ? { embeddable: status.embeddable } : {}),
      ...(typeof status.license === "string" ? { license: status.license } : {}),
      ...(typeof status.publicStatsViewable === "boolean" ? { publicStatsViewable: status.publicStatsViewable } : {}),
      ...(typeof status.containsSyntheticMedia === "boolean" ? { containsSyntheticMedia: status.containsSyntheticMedia } : {}),
    },
  };
}
