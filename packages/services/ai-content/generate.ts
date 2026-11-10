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
/** OpenAI structured output: plain field values (models often fail nested { value, … } shapes). */
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
                (f.kind === "tags" ? z.array(z.string()) : z.string()).describe(
                  `${t.platformLabel} ${f.label}. Apply user instructions in this string; respect limits.`,
                ),
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

type GeneratedEntry = { value?: unknown; instructionApplied?: boolean; note?: string } | unknown;

function entryValue(entry: GeneratedEntry): unknown {
  return entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
}

function requiredPrefix(target: GenerationTarget, globalInstruction?: string): string | null {
  const instructions = [globalInstruction, target.instruction].filter(Boolean).join("\n");
  // Handles e.g. "Start every title with ‘Interview #10 – ’". The account block comes last and wins conflicts.
  const matches = [...instructions.matchAll(/start(?:\s+[\p{L}\p{N}#_-]+){0,6}\s+with\s*[‘“"']([^’”"']+)[’”"']/giu)];
  return matches.at(-1)?.[1] ?? null;
}

function instructionProblem(target: GenerationTarget, _entry: GeneratedEntry, value: unknown, globalInstruction?: string): string | null {
  if (!globalInstruction && !target.instruction) return null;
  const prefix = requiredPrefix(target, globalInstruction);
  if (prefix && (typeof value !== "string" || !value.startsWith(prefix))) return `The final text must start with ${prefix}`;
  return null;
}

function evaluate(target: GenerationTarget, field: AiField, entry: GeneratedEntry, globalInstruction?: string) {
  const value = entryValue(entry);
  const checked = check(field, value);
  if (!checked.ok) return { ok: false as const, value, problem: checked.problem, instruction: false };
  const problem = instructionProblem(target, entry, checked.value, globalInstruction);
  return problem
    ? { ok: false as const, value: checked.value, problem, instruction: true }
    : { ok: true as const, value: checked.value };
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
  globalInstruction?: string;
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
  const failures: { key: string; target: GenerationTarget; field: AiField; value: string; original: unknown; problem: string; instruction: boolean }[] = [];

  for (const target of targets) {
    output[target.socialConnectionId] = {};
    for (const field of target.fields) {
      const entry = raw[target.key]?.[field.name];
      const result = evaluate(target, field, entry, params.globalInstruction);
      if (result.ok) output[target.socialConnectionId]![field.name] = result.value;
      else {
        const text = Array.isArray(result.value) ? result.value.join(", ") : String(result.value ?? "");
        failures.push({ key: target.key, target, field, value: text, original: result.value, problem: result.problem, instruction: result.instruction });
      }
    }
  }

  if (failures.length) {
    const only = new Map<string, AiField[]>();
    for (const f of failures) only.set(f.key, [...(only.get(f.key) ?? []), f.field]);
    let repaired: Record<string, Record<string, unknown>> = {};
    try {
      const second = await ai.generateStructured({
        system,
        user: buildRepairPrompt(failures, params.globalInstruction),
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
      const again = retried === undefined ? null : evaluate(target, field, retried, params.globalInstruction);
      if (again?.ok) {
        output[target.socialConnectionId]![field.name] = again.value;
        continue;
      }
      const instructionFailed = failure.instruction || Boolean(again && !again.ok && again.instruction);
      const original = retried === undefined ? failure.original : entryValue(retried);
      const fitted = forceFit(field, original);
      const final = check(field, fitted);
      if (final.ok) {
        output[target.socialConnectionId]![field.name] = final.value;
        if (instructionFailed) {
          issues.push({ socialConnectionId: target.socialConnectionId, field: field.name, message: "Couldn't apply your instruction within the limit" });
          continue;
        }
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
        issues.push({
          socialConnectionId: target.socialConnectionId,
          field: field.name,
          message: instructionFailed ? "Couldn't apply your instruction within the limit" : `Couldn't generate a valid value: ${final.problem}`,
        });
      }
    }
  }

  return { output, issues, usage, model: first.model, promptVersion: PROMPT_VERSION };
}
