import type { AiClient, AiUsage } from "@repo/ai";
import { z } from "zod";
import { measure, shortenToLimit, type AiField } from "./model";
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt, PROMPT_VERSION, type PromptTarget } from "./prompts/v1";
import type { Sources } from "./sources";

export type GenerationTarget = PromptTarget & { socialConnectionId: string };

export type GenerationResult = {
  output: Record<string, Record<string, unknown>>;
  issues: { socialConnectionId: string; field: string; message: string }[];
  usage: AiUsage;
  model: string;
  promptVersion: string;
};

/**
 * Structure the model must return. Limits are descriptions (models don't
 * reliably honour JSON-schema lengths, and the SDK helper would reject the
 * whole answer); the platform validators are applied afterwards.
 */
function requestSchema(targets: GenerationTarget[], only?: Map<string, AiField[]>) {
  return z.object(
    Object.fromEntries(
      targets
        .filter((t) => !only || only.has(t.key))
        .map((t) => [
          t.key,
          z.object(
            Object.fromEntries(
              (only?.get(t.key) ?? t.fields).map((f) => [
                f.name,
                (f.kind === "tags" ? z.array(z.string()) : z.string()).describe(`${t.platformLabel} ${f.label}`),
              ]),
            ),
          ),
        ]),
    ),
  );
}

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Invalid value";

function check(field: AiField, value: unknown): { ok: true; value: unknown } | { ok: false; problem: string } {
  const parsed = field.validator.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problem: firstIssue(parsed.error) };
}

/** Last resort: shorten at a word boundary (tags: drop from the end). */
function forceFit(field: AiField, value: unknown): unknown {
  if (field.kind === "tags" && Array.isArray(value)) {
    const tags = value.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim().slice(0, 100));
    while (tags.length && tags.join(",").length > (field.maxLength ?? 500)) tags.pop();
    return tags.slice(0, 50);
  }
  if (typeof value !== "string") return value;
  const clean = field.name === "title" || field.name === "description" ? value.replace(/[<>]/g, "") : value;
  return field.maxLength ? shortenToLimit(clean, field.maxLength, field.countMode) : clean;
}

const addUsage = (a: AiUsage, b: AiUsage): AiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
});

/**
 * generate → validate with each platform's field schema → ONE repair call
 * for failing fields → still failing: shorten at a word boundary + issue.
 */
export async function runGeneration(params: {
  ai: AiClient;
  targets: GenerationTarget[];
  sources: Sources;
  instruction?: string;
  video?: { orientation: string | null; durationSeconds: number | null } | null;
  model?: string;
}): Promise<GenerationResult> {
  const { ai, targets } = params;
  const system = buildSystemPrompt(targets);
  const first = await ai.generateStructured({
    system,
    user: buildUserPrompt(params),
    schema: requestSchema(targets),
    schemaName: "social_copy",
    model: params.model,
  });
  let usage = first.usage;
  const raw = first.data as Record<string, Record<string, unknown>>;

  const output: GenerationResult["output"] = {};
  const issues: GenerationResult["issues"] = [];
  const failures: { key: string; target: GenerationTarget; field: AiField; value: string; problem: string }[] = [];

  for (const target of targets) {
    output[target.socialConnectionId] = {};
    for (const field of target.fields) {
      const value = raw[target.key]?.[field.name];
      const result = check(field, value);
      if (result.ok) output[target.socialConnectionId]![field.name] = result.value;
      else failures.push({ key: target.key, target, field, value: Array.isArray(value) ? value.join(", ") : String(value ?? ""), problem: result.problem });
    }
  }

  if (failures.length) {
    const only = new Map<string, AiField[]>();
    for (const f of failures) only.set(f.key, [...(only.get(f.key) ?? []), f.field]);
    let repaired: Record<string, Record<string, unknown>> = {};
    try {
      const second = await ai.generateStructured({
        system,
        user: buildRepairPrompt(failures),
        schema: requestSchema(targets, only),
        schemaName: "social_copy_repair",
        model: params.model,
      });
      usage = addUsage(usage, second.usage);
      repaired = second.data as Record<string, Record<string, unknown>>;
    } catch {
      // Fall through to automatic shortening.
    }
    for (const failure of failures) {
      const { target, field } = failure;
      const retried = repaired[failure.key]?.[field.name];
      const again = retried === undefined ? null : check(field, retried);
      if (again?.ok) {
        output[target.socialConnectionId]![field.name] = again.value;
        continue;
      }
      const original = retried ?? (field.kind === "tags" ? failure.value.split(/,\s*/) : failure.value);
      const fitted = forceFit(field, original);
      const final = check(field, fitted);
      if (final.ok) {
        output[target.socialConnectionId]![field.name] = final.value;
        const unit = field.countMode === "bytes" ? "bytes" : "characters";
        issues.push({
          socialConnectionId: target.socialConnectionId,
          field: field.name,
          message:
            typeof fitted === "string" && field.maxLength
              ? `Shortened automatically to ${measure(fitted, field.countMode)}/${field.maxLength} ${unit}`
              : "Shortened automatically",
        });
      } else {
        issues.push({ socialConnectionId: target.socialConnectionId, field: field.name, message: `Couldn't generate a valid value: ${final.problem}` });
      }
    }
  }

  return { output, issues, usage, model: first.model, promptVersion: PROMPT_VERSION };
}
