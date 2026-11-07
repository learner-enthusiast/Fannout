import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts"],
  splitting: false,
  bundle: true,
  outDir: "./dist",
  clean: true,
  loader: { ".json": "copy" },
  minify: true,
  sourcemap: false,
});
