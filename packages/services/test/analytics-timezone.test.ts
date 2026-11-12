import assert from "node:assert/strict";
import { test } from "node:test";
import { postgresTimeZone } from "../analytics";

test("postgresTimeZone maps Intl-only legacy ids", () => {
  assert.equal(postgresTimeZone("Asia/Calcutta"), "Asia/Kolkata");
  assert.equal(postgresTimeZone("America/New_York"), "America/New_York");
});
