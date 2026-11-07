/*
 * Generates the agent-facing contract from the live tRPC router. Run from the
 * repository root with `pnpm docs:agent`; --check makes no writes.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateOpenApiDocument } from "trpc-to-openapi";
import { API_KEY_SCOPES, type ApiKeyScope } from "../packages/services/api-keys/model";
import { ErrorCode } from "../packages/errors";
import { allCapabilities } from "../packages/services/publishing/capabilities";
import { PLATFORMS } from "../packages/services/publishing/platforms";
import { RATE_LIMITS, type Bucket } from "../packages/services/rate-limit/rate-limiter";
import { serverRouter } from "../packages/trpc/server";

type Json = Record<string, unknown>;
type Procedure = {
  _def: {
    inputs: Array<{ toJSONSchema: (options?: unknown) => Json; safeParse: (value: unknown) => { success: boolean } }>;
    output?: { toJSONSchema: (options?: unknown) => Json; safeParse: (value: unknown) => { success: boolean } };
    middlewares: Array<((opts: unknown) => unknown) & { agentDocsSessionOnly?: true; agentDocsScope?: ApiKeyScope; agentDocsRateLimit?: Bucket }>;
    meta?: { openapi?: { method: string; path: string; summary?: string; description?: string }; agentDocsSessionOnly?: true; agentDocsScope?: ApiKeyScope; agentDocsRateLimit?: Bucket };
  };
};

// `pnpm --filter @repo/api exec` runs this from apps/api; INIT_CWD keeps the
// root when available and also makes direct `tsx scripts/...` use the cwd.
const root = resolve(process.env.INIT_CWD ?? (process.cwd().endsWith("/apps/api") ? resolve(process.cwd(), "../..") : process.cwd()));
const check = process.argv.includes("--check");
const generatedMarker = /<!-- GENERATED:([A-Z_]+) -->/g;
const UUID = "00000000-0000-4000-8000-000000000000";

function markdown(value: unknown): string {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function schemaType(schema: Json): string {
  const union = (schema.anyOf ?? schema.oneOf) as Json[] | undefined;
  if (Array.isArray(union)) return [...new Set(union.map(schemaType))].join(" | ");
  if (schema.type === "null") return "null";
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const type = schema.type;
  if (type === "array") return `${schemaType((schema.items as Json) ?? {})}[]`;
  if (type === "object") return "object";
  return typeof type === "string" ? type + (schema.format ? ` (${schema.format})` : "") : "unknown";
}

function constraints(schema: Json): string {
  const union = (schema.anyOf ?? schema.oneOf) as Json[] | undefined;
  if (Array.isArray(union)) {
    const inner = union.filter((member) => member.type !== "null").map(constraints).filter((text) => text !== "—");
    return inner.join("; ") || "—";
  }
  const pieces: string[] = [];
  const names: Array<[string, string]> = [["minimum", "min"], ["maximum", "max"], ["minLength", "min length"], ["maxLength", "max length"], ["minItems", "min items"], ["maxItems", "max items"], ["pattern", "pattern"]];
  for (const [key, label] of names) {
    // A format (uuid, email, …) already says what the pattern enforces.
    if (key === "pattern" && schema.format) continue;
    if (schema[key] !== undefined) pieces.push(`${label} ${String(schema[key])}`);
  }
  if (schema.format) pieces.push(`format ${schema.format}`);
  if (Array.isArray(schema.enum)) pieces.push(`enum: ${schema.enum.map(String).join(", ")}`);
  if (schema.default !== undefined) pieces.push(`default: ${JSON.stringify(schema.default)}`);
  return pieces.join("; ") || "—";
}

/** Dates travel as ISO-8601 strings; say so instead of "unknown". */
const JSON_SCHEMA_OPTIONS = {
  unrepresentable: "any",
  override: (ctx: { zodSchema: { _zod: { def: { type: string } } }; jsonSchema: Json }) => {
    if (ctx.zodSchema._zod.def.type === "date") Object.assign(ctx.jsonSchema, { type: "string", format: "date-time" });
  },
} as const;

type Row = { path: string; schema: Json; required: boolean };
function flatten(schema: Json, path = "", required = true): Row[] {
  const properties = schema.properties as Record<string, Json> | undefined;
  if (properties) {
    const requiredKeys = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    return Object.entries(properties).flatMap(([key, child]) => flatten(child, path ? `${path}.${key}` : key, required && requiredKeys.has(key)));
  }
  if (schema.type === "array" && schema.items && typeof schema.items === "object") {
    const items = schema.items as Json;
    if (items.properties || items.type === "array") return flatten(items, `${path}[]`, required);
  }
  return path ? [{ path, schema, required }] : [];
}

function rowsTable(schema: Json, includeRequired: boolean, warnings: string[], owner: string): string {
  const rows = flatten(schema);
  if (!rows.length) return "No fields.";
  const heading = includeRequired
    ? "| Field | Type | Required | Default | Constraints | Description |\n| --- | --- | --- | --- | --- | --- |"
    : "| Field | Type | Default | Constraints | Description |\n| --- | --- | --- | --- | --- |";
  return [heading, ...rows.map((row) => {
    const description = typeof row.schema.description === "string" ? row.schema.description : "Undocumented — see field name and constraints.";
    if (!row.schema.description) warnings.push(`${owner}: ${row.path}`);
    const base = [markdown(row.path), markdown(schemaType(row.schema))];
    if (includeRequired) base.push(row.required ? "required" : "optional");
    base.push(row.schema.default === undefined ? "—" : markdown(JSON.stringify(row.schema.default)));
    base.push(markdown(constraints(row.schema)), markdown(description));
    return `| ${base.join(" | ")} |`;
  })].join("\n");
}

function sample(schema: Json): unknown {
  if (schema.description === "undefined" && !schema.type && !schema.properties) return undefined;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) return sample((schema.anyOf ?? schema.oneOf as Json[])[0] as Json);
  if (schema.type === "object" || schema.properties) {
    const result: Json = {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    for (const [key, child] of Object.entries((schema.properties ?? {}) as Record<string, Json>)) if (required.has(key)) result[key] = sample(child);
    if (schema.additionalProperties && !Object.keys(result).length) result.example = sample(schema.additionalProperties as Json);
    return result;
  }
  if (schema.type === "array") return Array.from({ length: Math.max(1, Number(schema.minItems ?? 1)) }, () => sample((schema.items as Json) ?? {}));
  if (schema.type === "integer" || schema.type === "number") return Number(schema.minimum ?? 1);
  if (schema.type === "boolean") return false;
  if (schema.format === "uuid") return UUID;
  if (schema.format === "date-time") return new Date("2020-01-01T00:00:00.000Z");
  if (schema.format === "date") return "2020-01-01";
  if (schema.format === "uri" || schema.format === "url") return "https://example.com/resource";
  const min = Number(schema.minLength ?? 1);
  return "x".repeat(Math.max(1, min));
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item, 2);
}

function setAtPath(target: unknown, path: PropertyKey[], value: unknown) {
  let current = target as Record<PropertyKey, unknown>;
  for (const key of path.slice(0, -1)) {
    if (current[key] === undefined || current[key] === null) current[key] = typeof key === "number" ? [] : {};
    current = current[key] as Record<PropertyKey, unknown>;
  }
  current[path.at(-1)!] = value;
}

/** Zod JSON Schema intentionally serializes Date as string. Restore runtime Dates
 * before asserting output samples against the original Zod schema. */
function validateSample(schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; expected?: string }> } } }, value: unknown): boolean {
  let result = schema.safeParse(value);
  if (result.success) return true;
  for (const issue of result.error?.issues ?? []) {
    if (issue.expected === "date") setAtPath(value, issue.path, new Date("2020-01-01T00:00:00.000Z"));
  }
  result = schema.safeParse(value);
  return result.success;
}

function curl(method: string, path: string, body: unknown): string {
  const substitutedPath = path.replace(/\{[^}]+\}/g, UUID);
  const headers = "  -H \"Authorization: Bearer $FANNOUT_API_KEY\" \\\n+  -H 'Content-Type: application/json'";
  if (["GET", "DELETE"].includes(method) || body === undefined || (typeof body === "object" && body && !Object.keys(body as Json).length)) {
    return `curl -X ${method} \"${"${API_PUBLIC_URL}"}/api${substitutedPath}\" \\\n+${headers}`;
  }
  return `curl -X ${method} \"${"${API_PUBLIC_URL}"}/api${substitutedPath}\" \\\n+${headers} \\\n+  --data '${json(body)}'`;
}

function rate(bucket: Bucket | undefined): string {
  if (!bucket) return "none beyond the API-key `api` bucket";
  const windows = RATE_LIMITS.tiers.free[bucket].map((w) => `${w.points}/${w.duration}s`).join(", ");
  return `${bucket} (${windows}; plus API key api 60/60s)`;
}

function title(name: string): string {
  return name.split(".").map((part) => part.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())).join(" · ");
}

function endpointDocs(): { text: string; scopeUses: Map<ApiKeyScope, string[]>; warnings: string[]; count: number } {
  // Build it even though the tables use Zod JSON Schema: this detects router/OpenAPI incompatibilities and keeps the same source as /openapi.json.
  generateOpenApiDocument(serverRouter, { title: "Fannout OpenAPI", version: "1.0.0", baseUrl: "{API_PUBLIC_URL}/api" });
  const procedures = (serverRouter as unknown as { _def: { procedures: Record<string, Procedure> } })._def.procedures;
  const warnings: string[] = [];
  const scopeUses = new Map<ApiKeyScope, string[]>(API_KEY_SCOPES.map((scope) => [scope, []]));
  const docs = Object.entries(procedures)
    .filter(([, procedure]) => procedure._def.meta?.openapi)
    .filter(([, procedure]) => !procedure._def.meta?.agentDocsSessionOnly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, procedure]) => {
      const openapi = procedure._def.meta!.openapi!;
      const scope = procedure._def.meta?.agentDocsScope;
      const bucket = procedure._def.meta?.agentDocsRateLimit;
      if (scope) scopeUses.get(scope)!.push(`${openapi.method} ${openapi.path}`);
      const input = procedure._def.inputs.at(-1);
      const output = procedure._def.output;
      const inputJson = input?.toJSONSchema(JSON_SCHEMA_OPTIONS) ?? {};
      const outputJson = output?.toJSONSchema(JSON_SCHEMA_OPTIONS) ?? {};
      const request = sample(inputJson);
      // targets[].input is a per-platform record; show a real (YouTube) one instead of a placeholder.
      for (const target of ((request as { targets?: unknown[] } | undefined)?.targets ?? []) as Array<Record<string, unknown>>) {
        if (target && "input" in target) target.input = sample(PLATFORMS.youtube.schema.toJSONSchema(JSON_SCHEMA_OPTIONS) as Json);
      }
      const response = sample(outputJson);
      if (input && !validateSample(input, request)) throw new Error(`Generated request sample does not validate: ${name}`);
      if (output && !validateSample(output, response)) throw new Error(`Generated response sample does not validate: ${name}`);
      const purpose = openapi.summary ?? openapi.description ?? `Fannout ${name.replaceAll(".", " ")}.`;
      const errorCodes = [ErrorCode.UNAUTHORIZED, ErrorCode.FORBIDDEN, ErrorCode.TOO_MANY_REQUESTS, ErrorCode.VALIDATION, ErrorCode.BAD_REQUEST, ErrorCode.NOT_FOUND, ErrorCode.CONFLICT, ErrorCode.INTERNAL];
      if (name === "media.delete") errorCodes.splice(6, 0, ErrorCode.MEDIA_IN_USE);
      const requestCurl = curl(openapi.method, openapi.path, request).replaceAll("\n+", "\n");
      return `### ${title(name)}\n\n**${openapi.method} ${openapi.path}** — ${purpose}\n\n- Required scope: ${scope ? `\`${scope}\`` : "none (public)"}\n- Rate limit: ${rate(bucket)}\n- Possible errors: ${errorCodes.map((code) => `\`${code}\``).join(", ")}\n\n#### Request\n\n${rowsTable(inputJson, true, warnings, `${name} request`)}\n\n#### Example request\n\n\`\`\`bash\n${requestCurl}\n\`\`\`\n\n#### Response\n\n${rowsTable(outputJson, false, warnings, `${name} response`)}\n\n#### Example response\n\n\`\`\`json\n${json(response)}\n\`\`\``;
    });
  return { text: docs.join("\n\n"), scopeUses, warnings, count: docs.length };
}

function platformDocs(warnings: string[]): string {
  return allCapabilities().sort((a, b) => a.platform.localeCompare(b.platform)).map((capability) => {
    const definition = PLATFORMS[capability.platform];
    const schema = definition.schema.toJSONSchema(JSON_SCHEMA_OPTIONS) as Json;
    const summary = `video: ${capability.supportsVideo}; photos: ${capability.supportsPhotos}; max photos: ${capability.maxPhotos}; thumbnail: ${capability.supportsThumbnail}; delete: ${capability.supportsDelete}; edit: ${capability.supportsEdit} (${capability.editableFields.join(", ") || "none"}).`;
    const rules = Object.entries(capability.mediaRules).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${String(value)}`).join(", ") || "none";
    const example = sample(schema);
    if (!definition.schema.safeParse(example).success) throw new Error(`Generated ${capability.platform} input sample does not validate`);
    return `### ${capability.label} (${capability.platform})\n\n${summary}\n\n- Delete note: ${capability.deleteNote || "—"}\n- Edit note: ${capability.editNote || "—"}\n- Media rules: ${rules}\n\nFields for \`targets[].input\` when the account is ${capability.label}:\n\n${rowsTable(schema, true, warnings, `${capability.platform} platform input`)}\n\nMinimal valid \`input\` (required fields only):\n\n\`\`\`json\n${json(example)}\n\`\`\``;
  }).join("\n\n");
}

function scopesDocs(scopeUses: Map<ApiKeyScope, string[]>): string {
  return ["## Scopes", "", "| Scope | Operations |", "| --- | --- |", ...API_KEY_SCOPES.map((scope) => `| \`${scope}\` | ${(scopeUses.get(scope) ?? []).sort().join("<br>") || "None"} |`)].join("\n");
}

function rateDocs(): string {
  const rows = (Object.keys(RATE_LIMITS.tiers.free) as Bucket[]).sort().map((bucket) => {
    const windows = RATE_LIMITS.tiers.free[bucket].map((window) => `${window.points} requests / ${window.duration} seconds${window.blockDuration ? `; block ${window.blockDuration} seconds` : ""}`).join("<br>");
    return `| \`${bucket}\` | ${windows} |`;
  });
  return ["| Bucket | Free API-key limit |", "| --- | --- |", ...rows].join("\n");
}

function git(args: string[], fallback: string): string {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim() || fallback; } catch { return fallback; }
}

const endpoint = endpointDocs();
const warnings = endpoint.warnings;
const blocks: Record<string, string> = {
  SHA: git(["rev-parse", "--short", "HEAD"], "unknown"),
  DATE: git(["log", "-1", "--format=%cs"], "unknown date"),
  SCOPES: scopesDocs(endpoint.scopeUses),
  RATE_LIMITS: rateDocs(),
  PLATFORMS: platformDocs(warnings),
  ENDPOINTS: endpoint.text,
};
const template = readFileSync(resolve(root, "docs/ai.template.md"), "utf8");
const document = template.replace(generatedMarker, (_all, name: string) => blocks[name] ?? "").replace(/\n{3,}/g, "\n\n");
const guideModule = `// Generated by scripts/generate-agent-docs.ts. Do not edit.\nexport const agentGuide = ${JSON.stringify(document)};\n`;
const docPath = resolve(root, "docs/ai.md");
const modulePath = resolve(root, "apps/api/src/generated/agent-guide.ts");

if (check) {
  // The header names HEAD's sha/date, which changes the moment ai.md is
  // committed — compare everything except that line. The served module must
  // match the checked-in ai.md byte for byte.
  const header = /^Generated from code at .* on .*\. Do not edit generated sections by hand\.$/m;
  const normalize = (text: string) => text.replace(header, "Generated from code at <sha> on <date>.");
  const existing = readFileSync(docPath, "utf8");
  const existingModule = (() => { try { return readFileSync(modulePath, "utf8"); } catch { return ""; } })();
  const stale = normalize(existing) !== normalize(document)
    || existingModule !== `// Generated by scripts/generate-agent-docs.ts. Do not edit.\nexport const agentGuide = ${JSON.stringify(existing)};\n`;
  if (stale) {
    console.error("ai.md is stale — run pnpm docs:agent");
    process.exitCode = 1;
  }
} else {
  mkdirSync(resolve(root, "apps/api/src/generated"), { recursive: true });
  writeFileSync(docPath, document);
  writeFileSync(modulePath, guideModule);
  console.log(`Generated docs/ai.md with ${endpoint.count} API-key-accessible endpoints.`);
}

if (warnings.length) {
  console.warn(`Missing .describe() (${warnings.length} fields):\n${[...new Set(warnings)].sort().map((warning) => `- ${warning}`).join("\n")}`);
}
