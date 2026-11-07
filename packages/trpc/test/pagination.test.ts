import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { serverRouter } from "../server";
import { PAGINATION_ALLOWLIST } from "./pagination-allowlist";

type ProcedureDef = { inputs?: unknown[]; output?: unknown };
const procedures = serverRouter._def.procedures as Record<string, { _def: ProcedureDef }>;

const unwrap = (schema: unknown): unknown => {
  let current = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
    current = (current as z.ZodOptional<z.ZodType>).unwrap();
  }
  return current;
};

/** Returns a list: a bare array, or { items: [...] }. */
function returnsList(output: unknown): boolean {
  const schema = unwrap(output);
  if (schema instanceof z.ZodArray) return true;
  if (schema instanceof z.ZodObject) return unwrap((schema.shape as Record<string, unknown>).items) instanceof z.ZodArray;
  return false;
}

/** Input extends PaginationInput: has cursor + limit (default 10, max 10). */
function isPaginated(input: unknown): string | null {
  const schema = unwrap(input);
  if (!(schema instanceof z.ZodObject)) return "input is not an object with cursor/limit";
  const shape = schema.shape as Record<string, z.ZodType>;
  if (!shape.cursor) return "missing cursor";
  if (!shape.limit) return "missing limit";
  if (shape.limit.safeParse(11).success) return "limit allows more than 10";
  if (shape.limit.parse(undefined) !== 10) return "limit must default to 10";
  return null;
}

test("every list-returning procedure is cursor-paginated (limit default/max 10)", () => {
  const problems: string[] = [];
  const lists: string[] = [];
  for (const [path, procedure] of Object.entries(procedures)) {
    if (!returnsList(procedure._def.output)) continue;
    lists.push(path);
    if (PAGINATION_ALLOWLIST[path]) continue;
    const problem = isPaginated(procedure._def.inputs?.[0]);
    if (problem) problems.push(`${path}: ${problem}`);
  }
  assert.deepEqual(problems, [], `Paginate these (or justify them in pagination-allowlist.ts):\n${problems.join("\n")}`);
  assert.ok(lists.length >= 8, "the scan found the list procedures");
});

test("allowlist entries are real and explained", () => {
  for (const [path, reason] of Object.entries(PAGINATION_ALLOWLIST)) {
    assert.ok(procedures[path], `${path} doesn't exist`);
    assert.ok(reason.length > 20, `${path} needs a real reason`);
  }
});
