import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createStickerFromBuffer,
  isAnimatedWebp,
  isWebp,
} from "../mias/lib/stickerMedia.js";

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("video sticker conversion emits an animated WebP and cleans temp work", {
  skip: !ffmpegAvailable,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mias-sticker-test-"));
  try {
    const input = path.join(dir, "input.mp4");
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=96x96:rate=8",
      "-t", "1", input,
    ]);
    const before = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("mias-sticker-")));
    const output = await createStickerFromBuffer(fs.readFileSync(input), {
      mediaType: "video/mp4",
      pack: "Test",
      author: "Test",
    });
    const after = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("mias-sticker-")));
    assert.equal(isWebp(output), true);
    assert.equal(isAnimatedWebp(output), true);
    assert.deepEqual([...after].sort(), [...before].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});