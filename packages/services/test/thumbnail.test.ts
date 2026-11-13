import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateThumbnail, THUMBNAIL_WIDTH, thumbnailKeyFor } from "../media/thumbnail";

test("thumbnailKeyFor puts the thumbnail next to the original", () => {
  assert.equal(thumbnailKeyFor("media/u/abc.mp4"), "media/u/abc.mp4.thumb.jpg");
});

test("generateThumbnail returns a JPEG no wider than the cap (image and video)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "thumb-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const image = join(dir, "in.png");
  const video = join(dir, "in.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720", "-frames:v", "1", image]);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=10:duration=3", "-pix_fmt", "yuv420p", video]);
  for (const [file, type] of [[image, "image"], [video, "video"]] as const) {
    const jpeg = await generateThumbnail(file, type, type === "video" ? 3 : null);
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff], `${type}: JPEG magic bytes`);
    const out = join(dir, `${type}.jpg`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-i", "pipe:0", out], { input: jpeg });
    const width = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", out]).toString().trim());
    assert.ok(width <= THUMBNAIL_WIDTH && width > 0, `${type}: width ${width}`);
  }
});
