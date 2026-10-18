import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const facebook = require("../mias/lib/facebookDownloader.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = fs.readFileSync(path.join(ROOT, "mias", "index.js"), "utf8");

function fakeMp4() {
  const buffer = Buffer.alloc(4096);
  buffer.write("ftyp", 4, "ascii");
  return buffer;
}

function makeCommand(overrides = {}) {
  const reactions = [];
  const statuses = [];
  const sent = [];
  const replies = [];
  const urls = [];
  const msg = { key: { remoteJid: "chat@s.whatsapp.net", id: "command-id" } };
  const handler = facebook.createFacebookCommand({
    getPrefix: () => ".",
    getQuotedText: () => "",
    react: async (_sock, _msg, emoji) => reactions.push(emoji),
    sendReply: async (_sock, _msg, text) => replies.push(text),
    sendStatus: async () => ({ key: { id: "status-id" } }),
    editStatus: async (_sock, _msg, _key, text) => statuses.push(text),
    resolveMedia: async (url) => {
      urls.push(url);
      return {
        buffer: fakeMp4(),
        mimetype: "video/mp4",
        extension: ".mp4",
        quality: "HD",
        title: "Example video",
      };
    },
    sendVideo: async (_sock, _msg, media, options) => sent.push({ type: "video", media, options }),
    sendDocument: async (_sock, _msg, media, options) => sent.push({ type: "document", media, options }),
    sendAudio: async (_sock, _msg, buffer, options) => sent.push({ type: "audio", buffer, options }),
    extractAudio: async () => Buffer.alloc(1024),
    ...overrides,
  });

  return { handler, msg, reactions, statuses, sent, replies, urls };
}

test("Facebook links are extracted from direct text and quoted captions, but not unrelated sites", () => {
  assert.equal(
    facebook.extractFacebookUrl("Here: https://www.facebook.com/watch/?v=12345)."),
    "https://www.facebook.com/watch/?v=12345",
  );
  assert.equal(facebook.extractFacebookUrl("Reply contains https://fb.watch/abc123."), "https://fb.watch/abc123");
  assert.equal(facebook.extractFacebookUrl("https://example.com/watch/123"), null);
  assert.equal(facebook.cleanLinkCandidate("https://evil-facebook.com/video/1"), null);
});

test("nested API response normalization selects HD over SD and ignores thumbnail URLs", () => {
  const candidates = facebook.normalizeFacebookCandidates({
    result: {
      title: "Test clip",
      media: [
        { quality: "SD 480p", url: "https://cdn.example/sd.mp4" },
        { quality: "1080p HD", download_url: "https://cdn.example/hd.mp4" },
      ],
      thumbnail: "https://cdn.example/cover.jpg",
    },
  }, "NexRay");

  assert.equal(candidates[0].url, "https://cdn.example/hd.mp4");
  assert.equal(candidates[0].quality, "HD");
  assert.equal(candidates[0].title, "Test clip");
  assert.equal(candidates.some((candidate) => candidate.url.endsWith("cover.jpg")), false);
});

test("provider waterfall downloads the HD candidate first and validates the video bytes", async () => {
  const fetched = [];
  const downloaded = [];
  const result = await facebook.resolveAndDownloadFacebook(
    "https://www.facebook.com/watch/?v=123",
    [{
      name: "NexRay",
      fetch: async () => ({
        data: {
          videos: [
            { quality: "SD", url: "https://cdn.example/sd.mp4" },
            { quality: "1080p", url: "https://cdn.example/hd.mp4" },
          ],
        },
      }),
    }],
    {
      maxBytes: 1024 * 1024,
      download: async (url) => {
        fetched.push(url);
        downloaded.push(url);
        return { status: 200, headers: { "content-type": "video/mp4" }, data: fakeMp4() };
      },
    },
  );

  assert.equal(result.quality, "HD");
  assert.equal(result.mimetype, "video/mp4");
  assert.deepEqual(fetched, ["https://cdn.example/hd.mp4"]);
  assert.deepEqual(downloaded, fetched);
});

test("an expired HD link falls through to the next provider's playable source", async () => {
  const downloaded = [];
  const result = await facebook.resolveAndDownloadFacebook(
    "https://fb.watch/clip",
    [
      { name: "NexRay", fetch: async () => ({ hd: "https://cdn.example/expired-hd.mp4" }) },
      { name: "Prexzy", fetch: async () => ({ sd: "https://cdn.example/working-sd.mp4" }) },
    ],
    {
      download: async (url) => {
        downloaded.push(url);
        if (url.includes("expired")) {
          return { status: 403, headers: { "content-type": "text/html" }, data: Buffer.from("<html>expired</html>") };
        }
        return { status: 200, headers: { "content-type": "application/octet-stream" }, data: fakeMp4() };
      },
    },
  );

  assert.equal(result.quality, "SD");
  assert.equal(result.source, "Prexzy");
  assert.deepEqual(downloaded, ["https://cdn.example/expired-hd.mp4", "https://cdn.example/working-sd.mp4"]);
});

test("API error pages are rejected instead of being silently sent as video", () => {
  assert.throws(
    () => facebook.inspectFacebookVideo(Buffer.alloc(2048, 65), "text/html"),
    { code: "FB_INVALID_VIDEO" },
  );
  assert.throws(
    () => facebook.inspectFacebookVideo(fakeMp4(), "video/mp4", 1024),
    { code: "FB_FILE_TOO_LARGE" },
  );
});

test("Facebook command replies to quoted links and produces 🌀 then ✅ feedback", async () => {
  const testCommand = makeCommand({
    getQuotedText: () => "Facebook clip: https://fb.watch/quoted-clip",
  });
  const result = await testCommand.handler({}, testCommand.msg, []);

  assert.equal(result.ok, true);
  assert.equal(testCommand.urls[0], "https://fb.watch/quoted-clip");
  assert.deepEqual(testCommand.reactions, ["🌀", "✅"]);
  assert.equal(testCommand.sent[0].type, "video");
  assert.match(testCommand.statuses.at(-1), /^✅ Facebook HD video delivered/);
});

test("invalid links and provider failures always produce an explicit ❌ response", async () => {
  const invalid = makeCommand();
  const invalidResult = await invalid.handler({}, invalid.msg, ["https://example.com/video"]);
  assert.equal(invalidResult.ok, false);
  assert.deepEqual(invalid.reactions, ["🌀", "❌"]);
  assert.match(invalid.replies[0], /valid, public Facebook video URL/i);
  assert.match(invalid.replies[0], /Usage:/);

  const failure = makeCommand({
    getQuotedText: () => "https://fb.watch/unavailable",
    resolveMedia: async () => { throw Object.assign(new Error("no source"), { code: "FB_NO_SOURCE" }); },
  });
  const failureResult = await failure.handler({}, failure.msg, []);
  assert.equal(failureResult.ok, false);
  assert.deepEqual(failure.reactions, ["🌀", "❌"]);
  assert.match(failure.statuses.at(-1), /private, age-restricted|geo-blocked/i);
});

test("video delivery falls back to an original-quality document and audio mode extracts audio", async () => {
  const fallback = makeCommand({
    sendVideo: async () => { throw new Error("video send refused"); },
  });
  const fallbackResult = await fallback.handler({}, fallback.msg, ["https://facebook.com/watch?v=vid"]);
  assert.equal(fallbackResult.ok, true);
  assert.equal(fallbackResult.deliveredAs, "file");
  assert.equal(fallback.sent.at(-1).type, "document");

  const audio = makeCommand();
  const audioResult = await audio.handler({}, audio.msg, ["https://facebook.com/watch?v=vid", "audio"]);
  assert.equal(audioResult.ok, true);
  assert.equal(audio.sent[0].type, "audio");
});

test("both initial and late command registrations point every Facebook alias at the shared handler", () => {
  assert.match(INDEX, /cmd\(\["facebook", "fb"\][\s\S]{0,220}__facebookCommand\)/);
  assert.match(INDEX, /const __fbV19 = __facebookCommand/);
  for (const alias of ["fb-dl", "fbdl", "facebook-dl", "fbv2", "facebookv2", "metav2"]) {
    assert.ok(INDEX.includes(`"${alias}"`), `missing Facebook alias ${alias}`);
  }
  assert.match(INDEX, /for \(const _fn of \["facebook", "fb", "fb-dl", "fbdl", "facebook-dl", "fbv2", "facebookv2", "metav2"\]\)/);
});
