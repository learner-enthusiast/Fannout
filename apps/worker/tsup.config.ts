import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts"],
  splitting: false,
  bundle: true,
  // Workspace packages are source-only (no package.json exports); bundle them for `node dist`.
  noExternal: [/^@repo\//],
  outDir: "./dist",
  clean: true,
  loader: { ".json": "copy" },
  minify: true,
  sourcemap: false,
});
