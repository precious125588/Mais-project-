import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const {
  createTikTokFileName,
  fetchVideoCandidate,
  sendDocumentFromDisk,
  sendVideoFromDisk,
} = require("../mias/lib/tiktokDiskDelivery.cjs");
const indexSource = fs.readFileSync(new URL("../mias/index.js", import.meta.url), "utf8");
const v32Start = indexSource.indexOf(
  "async function __v32ExecuteTikTokDownload(sock, msg, ttPick, ttMode) {",
);
const v32End = indexSource.indexOf("\n  /* ── Native picker", v32Start);
assert.ok(v32Start >= 0 && v32End > v32Start, "active v32 TikTok delivery handler is present");
const v32Source = indexSource.slice(v32Start, v32End);
const requireMias = createRequire(new URL("../mias/index.js", import.meta.url));

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

function makeV32Handler({ failUpload = false } = {}) {
  const { dir, filePath } = makeMp4File();
  const sourceBytes = fs.readFileSync(filePath);
  const downloadOptions = [];
  let cleanupCalls = 0;
  const statusReplies = [];
  const pipeline = {
    async fetchToDisk(url, options) {
      assert.equal(url, "https://cdn.example/hd.mp4");
      downloadOptions.push(options);
      return {
        path: filePath,
        bytes: sourceBytes.length,
        async cleanup() {
          cleanupCalls += 1;
          await fs.promises.rm(filePath, { force: true });
        },
      };
    },
  };
  const sandbox = {
    PIPE: pipeline,
    TIKTOK_DOWNLOAD_MAX_BYTES: 300 * 1024 * 1024,
    TT_VIDEO_ENCODE: { maxInputBytes: 1024 },
    ensureDiskSpace() {},
    selectTikTokUrl: () => "https://cdn.example/hd.mp4",
    forceReaction: async () => {},
    sendReply: async (_sock, _msg, text) => { statusReplies.push(text); },
    editMessage: async () => {},
    require: id => requireMias(id),
    console: { error() {} },
  };
  vm.runInNewContext(`${v32Source}\nglobalThis.run = __v32ExecuteTikTokDownload;`, sandbox);

  const sentMessages = [];
  const sock = {
    async sendMessage(jid, payload, options) {
      sentMessages.push({ jid, payload, options });
      const filePathToSend = payload.document?.url || payload.video?.url;
      if (filePathToSend) {
        assert.deepEqual(fs.readFileSync(filePathToSend), sourceBytes);
      }
      if (failUpload && (payload.video || payload.document)) {
        throw new Error("simulated upload failure");
      }
      return { key: { id: "sent" } };
    },
  };
  const msg = { key: { remoteJid: "123@s.whatsapp.net", id: "request" } };
  const pick = { info: { title: "Original TikTok title", author: "Creator" } };

  return {
    dir,
    filePath,
    downloadOptions,
    get cleanupCalls() { return cleanupCalls; },
    sentMessages,
    sourceBytes,
    statusReplies,
    run: mode => sandbox.run(sock, msg, pick, mode),
  };
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

test("a 255 MiB TikTok MP4 stays on disk instead of becoming a Buffer", async () => {
  const size = 255 * 1024 * 1024;
  const { dir, filePath } = makeMp4File(size);
  const pipeline = {
    async fetchToDisk() {
      return {
        path: filePath,
        bytes: size,
        cleanup() {
          fs.rmSync(filePath, { force: true });
        },
      };
    },
  };

  try {
    const result = await fetchVideoCandidate("https://cdn.example/255mb.mp4", {
      pipeline,
      cap: 300 * 1024 * 1024,
      maxBufferedBytes: 120 * 1024 * 1024,
    });
    assert.equal(result.buffer, null);
    assert.equal(result.file.bytes, size);
    assert.equal(fs.statSync(result.file.path).size, size);
    await result.file.cleanup();
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

test("oversized non-MP4 candidates are rejected without being buffered", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mias-tt-test-"));
  const filePath = path.join(dir, "unexpected.bin");
  fs.writeFileSync(filePath, Buffer.concat([Buffer.from("not an mp4"), Buffer.alloc(4096)]));
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
    const result = await fetchVideoCandidate("https://cdn.example/not-video", {
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

test("document filenames preserve the TikTok title and use a safe extension", () => {
  assert.equal(
    createTikTokFileName("Original video title", ".mp4"),
    "Original video title.mp4",
  );
  assert.equal(
    createTikTokFileName("  ../Original: video?  ", ".MP4"),
    "Original video.mp4",
  );
  assert.equal(createTikTokFileName("Title.mp4", ".mp4"), "Title.mp4");
  assert.equal(createTikTokFileName("", ".mp4"), "TikTok video.mp4");
  assert.equal(createTikTokFileName("Title", "../bad"), "Title.mp4");
});

test("disk document delivery includes the original title and local-file source", async () => {
  let call;
  const sock = {
    async sendMessage(...args) {
      call = args;
      return { key: { id: "sent" } };
    },
  };
  const quoted = { key: { id: "quoted" } };
  const fileName = createTikTokFileName("Original TikTok title", ".mp4");

  await sendDocumentFromDisk(
    sock,
    "123@s.whatsapp.net",
    "/tmp/original.mp4",
    fileName,
    "TikTok caption",
    quoted,
  );

  assert.equal(call[0], "123@s.whatsapp.net");
  assert.deepEqual(call[1], {
    document: { url: "/tmp/original.mp4" },
    mimetype: "video/mp4",
    fileName: "Original TikTok title.mp4",
    caption: "TikTok caption",
  });
  assert.equal(call[2].quoted, quoted);
});

test("live v32 TikTok HD document delivery streams from disk with the original title", async () => {
  const harness = makeV32Handler();
  try {
    await harness.run({ id: "1.3", kind: "video", quality: "hd", document: true });

    const document = harness.sentMessages.find(message => message.payload.document);
    assert.deepEqual(document.payload.document, { url: harness.filePath });
    assert.equal(document.payload.fileName, "Original TikTok title.mp4");
    assert.equal(harness.downloadOptions[0].cap, 300 * 1024 * 1024);
    assert.equal(harness.cleanupCalls, 1);
    assert.equal(fs.existsSync(harness.filePath), false);
  } finally {
    fs.rmSync(harness.dir, { recursive: true, force: true });
  }
});

test("live v32 TikTok HD video delivery cleans up after upload failure", async () => {
  const harness = makeV32Handler({ failUpload: true });
  try {
    await harness.run({ id: "1.3", kind: "video", quality: "hd" });

    const video = harness.sentMessages.find(message => message.payload.video);
    assert.deepEqual(video.payload.video, { url: harness.filePath });
    assert.equal(harness.cleanupCalls, 1);
    assert.equal(fs.existsSync(harness.filePath), false);
    assert.ok(harness.statusReplies.some(text => String(text).includes("simulated upload failure")));
  } finally {
    fs.rmSync(harness.dir, { recursive: true, force: true });
  }
});

test("the active TikTok picker uses file streaming only above its normalizer limit", () => {
  assert.match(indexSource, /maxBufferedBytes:\s*TT_VIDEO_ENCODE\.maxInputBytes/);
  assert.match(indexSource, /tiktokDiskDelivery\.fetchVideoCandidate/);
  assert.match(indexSource, /tiktokDiskDelivery\.sendVideoFromDisk/);
  assert.match(indexSource, /tiktokDiskDelivery\.sendDocumentFromDisk/);
  assert.match(indexSource, /tiktokDiskDelivery\.createTikTokFileName\(ttPick\.info\.title/);
  assert.match(indexSource, /Sending the original MP4 without re-encoding/);
  assert.match(indexSource, /finally \{\s*if \(mediaFile\?\.cleanup\)/);
  assert.match(v32Source, /fetchVideoCandidate\(mediaUrl/);
  assert.match(v32Source, /maxBufferedBytes:\s*TT_VIDEO_ENCODE\.maxInputBytes/);
  assert.match(v32Source, /sendDocumentFromDisk/);
  assert.match(v32Source, /if \(downloaded && typeof downloaded\.cleanup/);
});
