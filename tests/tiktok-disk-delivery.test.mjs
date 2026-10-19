import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { fetchVideoCandidate, sendVideoFromDisk } = require("../mias/lib/tiktokDiskDelivery.cjs");
const indexSource = fs.readFileSync(new URL("../mias/index.js", import.meta.url), "utf8");

function makeMp4File(size = 4096) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mias-tt-test-"));
  const filePath = path.join(dir, "video.mp4");
  const header = Buffer.alloc(64, 0);
  header.write("ftyp", 4, "ascii");
  header.write("isom", 8, "ascii");
  fs.writeFileSync(filePath, header);
  fs.truncateSync(filePath, size);
  return { dir, filePath };
}

test("large MP4 candidates stay file-backed and receive the configured TikTok cap", async () => {
  const { dir, filePath } = makeMp4File();
  const optionsSeen = [];
  let cleanupCalls = 0;
  const pipeline = {
    async fetchToDisk(url, options) {
      assert.equal(url, "https://cdn.example/video.mp4");
      optionsSeen.push(options);
      return {
        path: filePath,
        bytes: 4096,
        cleanup() {
          cleanupCalls += 1;
          fs.rmSync(filePath, { force: true });
        },
      };
    },
  };

  try {
    const result = await fetchVideoCandidate("https://cdn.example/video.mp4", {
      pipeline,
      cap: 300 * 1024 * 1024,
      maxBufferedBytes: 1024,
      timeout: 90000,
      headers: { Referer: "https://www.tiktok.com/" },
    });

    assert.equal(result.buffer, null);
    assert.equal(result.file.path, filePath);
    assert.equal(result.file.bytes, 4096);
    assert.equal(optionsSeen[0].cap, 300 * 1024 * 1024);
    assert.equal(optionsSeen[0].timeout, 90000);
    assert.equal(optionsSeen[0].headers.Referer, "https://www.tiktok.com/");
    assert.equal(cleanupCalls, 0, "keep the file until WhatsApp finishes sending it");

    await result.file.cleanup();
    assert.equal(cleanupCalls, 1);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("small MP4 candidates keep the existing Buffer-based processing path", async () => {
  const { dir, filePath } = makeMp4File();
  let cleanupCalls = 0;
  const pipeline = {
    async fetchToDisk() {
      return {
        path: filePath,
        bytes: 4096,
        cleanup() {
          cleanupCalls += 1;
          fs.rmSync(filePath, { force: true });
        },
      };
    },
  };

  try {
    const result = await fetchVideoCandidate("https://cdn.example/small.mp4", {
      pipeline,
      cap: 300 * 1024 * 1024,
      maxBufferedBytes: 8192,
    });
    assert.ok(Buffer.isBuffer(result.buffer));
    assert.equal(result.buffer.length, 4096);
    assert.equal(result.file, null);
    assert.equal(cleanupCalls, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("metadata responses are rejected and their temporary files are removed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mias-tt-test-"));
  const filePath = path.join(dir, "response.bin");
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from("<!doctype html>"), Buffer.alloc(4096)]));
  let cleanupCalls = 0;
  const pipeline = {
    async fetchToDisk() {
      return {
        path: filePath,
        bytes: fs.statSync(filePath).size,
        cleanup() {
          cleanupCalls += 1;
          fs.rmSync(filePath, { force: true });
        },
      };
    },
  };

  try {
    const result = await fetchVideoCandidate("https://cdn.example/error", {
      pipeline,
      cap: 300 * 1024 * 1024,
      maxBufferedBytes: 1024,
    });
    assert.equal(result, null);
    assert.equal(cleanupCalls, 1);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("disk delivery sends Baileys a local file source instead of a video Buffer", async () => {
  let call;
  const sock = {
    async sendMessage(...args) {
      call = args;
      return { key: { id: "sent" } };
    },
  };
  const quoted = { key: { id: "quoted" } };

  await sendVideoFromDisk(sock, "123@s.whatsapp.net", "/tmp/original.mp4", "TikTok caption", quoted);

  assert.equal(call[0], "123@s.whatsapp.net");
  assert.deepEqual(call[1], {
    video: { url: "/tmp/original.mp4" },
    mimetype: "video/mp4",
    caption: "TikTok caption",
  });
  assert.equal(call[2].quoted, quoted);
  assert.equal(Buffer.isBuffer(call[1].video), false);
});

test("the active TikTok picker uses file streaming only above its normalizer limit", () => {
  assert.match(indexSource, /maxBufferedBytes:\s*TT_VIDEO_ENCODE\.maxInputBytes/);
  assert.match(indexSource, /tiktokDiskDelivery\.fetchVideoCandidate/);
  assert.match(indexSource, /tiktokDiskDelivery\.sendVideoFromDisk/);
  assert.match(indexSource, /Sending the original MP4 without re-encoding/);
});
