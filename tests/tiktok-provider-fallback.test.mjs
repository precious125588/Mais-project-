import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fetchTikTokInfo,
  fetchTikTokThumbnail,
  normalizeTikTokMode,
  parseTikTokMode,
  selectTikTokUrl,
  TIKTOK_PROVIDER_NAMES,
} from "../mias/features/tiktok.js";

const sampleUrl = "https://vm.tiktok.com/example/";
const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

test("one TikWM 403 falls through to Prexzy and preserves the picker media fields", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://www.tikwm.com/")) return jsonResponse({}, 403);
    if (url.startsWith("https://prexzyapis.com/")) {
      return jsonResponse({
        status: true,
        data: {
          title: "Fallback test",
          author: { nickname: "Test creator" },
          play: "https://cdn.example/sd.mp4",
          hdplay: "https://cdn.example/hd.mp4",
          wmplay: "https://cdn.example/watermark.mp4",
          music: "https://cdn.example/audio.mp3",
          cover: "https://cdn.example/cover.jpg",
        },
      });
    }
    return jsonResponse({}, 503);
  };

  const info = await fetchTikTokInfo(sampleUrl, fetchImpl);
  assert.equal(info.title, "Fallback test");
  assert.equal(info.author, "Test creator");
  assert.equal(selectTikTokUrl(info, parseTikTokMode("1.3")), "https://cdn.example/hd.mp4");
  assert.equal(selectTikTokUrl(info, parseTikTokMode("1.1")), "https://cdn.example/sd.mp4");
  assert.equal(selectTikTokUrl(info, parseTikTokMode("1.5")), "https://cdn.example/watermark.mp4");
  assert.equal(selectTikTokUrl(info, parseTikTokMode("2.1")), "https://cdn.example/audio.mp3");
  assert.equal(calls.length, 7);
});

test("Nexray's nested result.data URL is normalized as downloadable media", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://www.tikwm.com/")) return jsonResponse({}, 403);
    if (url.includes("/downloader/tiktok?")) {
      return jsonResponse({ status: true, result: { title: "Nexray", data: "https://cdn.example/nexray.mp4" } });
    }
    return jsonResponse({}, 503);
  };
  const info = await fetchTikTokInfo(sampleUrl, fetchImpl);
  assert.equal(info.title, "Nexray");
  assert.equal(info.videoHd, "https://cdn.example/nexray.mp4");
  assert.equal(selectTikTokUrl(info, parseTikTokMode("hd")), info.videoHd);
});

test("a 200 response without media still lets an alternate provider resolve the link", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://www.tikwm.com/")) return jsonResponse({ success: true });
    if (url.startsWith("https://prexzyapis.com/")) {
      return jsonResponse({ data: { title: "Prexzy fallback", hdplay: "https://cdn.example/prexzy.mp4" } });
    }
    return jsonResponse({}, 503);
  };
  const info = await fetchTikTokInfo(sampleUrl, fetchImpl);
  assert.equal(info.title, "Prexzy fallback");
  assert.equal(info.videoHd, "https://cdn.example/prexzy.mp4");
});

test("a healthy primary provider does not fan out to other providers", async () => {
  const calls = [];
  const info = await fetchTikTokInfo(sampleUrl, async (url) => {
    calls.push(url);
    return jsonResponse({ data: { title: "Primary", play: "https://cdn.example/primary.mp4" } });
  });
  assert.equal(info.title, "Primary");
  assert.equal(calls.length, 1);
});

test("provider list has seven routes and invalid TikTok links are rejected before requests", async () => {
  assert.equal(TIKTOK_PROVIDER_NAMES.length, 7);
  let calls = 0;
  await assert.rejects(fetchTikTokInfo("https://example.com/not-tiktok", async () => {
    calls += 1;
    return jsonResponse({});
  }), { code: "INVALID_URL" });
  assert.equal(calls, 0);
  assert.equal(normalizeTikTokMode(".1.3"), "1.3");
});

test("fallback requests do not hit alternate endpoints on the same provider at once", async () => {
  const activeByOrigin = new Map();
  const maxActiveByOrigin = new Map();
  const fetchImpl = async (url) => {
    const origin = new URL(url).origin;
    const active = (activeByOrigin.get(origin) || 0) + 1;
    activeByOrigin.set(origin, active);
    maxActiveByOrigin.set(origin, Math.max(maxActiveByOrigin.get(origin) || 0, active));
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeByOrigin.set(origin, activeByOrigin.get(origin) - 1);
    return jsonResponse({}, 503);
  };

  await assert.rejects(fetchTikTokInfo(sampleUrl, fetchImpl), { code: "ALL_PROVIDERS_FAILED" });
  assert.equal(maxActiveByOrigin.get("https://api.nexray.eu.cc"), 1);
  assert.equal(maxActiveByOrigin.get("https://apis.davidcyril.name.ng"), 1);
});

test("TikTok preview picks a fast valid cover from a bounded concurrent set", async () => {
  const requested = [];
  const signals = [];
  const cover = await fetchTikTokThumbnail([
    "https://cdn.example/stale.jpg",
    "https://cdn.example/working.jpg",
    "https://cdn.example/third.jpg",
    "https://cdn.example/fourth.jpg",
    "https://cdn.example/never-requested.jpg",
  ], {
    async get(url, options) {
      requested.push(url);
      signals.push(options.signal);
      if (url.endsWith("stale.jpg")) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error("stale preview");
      }
      if (url.endsWith("working.jpg")) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return { data: Buffer.alloc(2048, 7) };
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { data: Buffer.alloc(2048, 8) };
    },
  });

  assert.ok(Buffer.isBuffer(cover));
  assert.equal(cover.length, 2048);
  assert.equal(requested.length, 4);
  assert.deepEqual(requested.sort(), [
    "https://cdn.example/fourth.jpg",
    "https://cdn.example/stale.jpg",
    "https://cdn.example/third.jpg",
    "https://cdn.example/working.jpg",
  ]);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("TikTok preview returns without an image when every cover fails", async () => {
  const cover = await fetchTikTokThumbnail(
    ["https://cdn.example/bad.jpg"],
    { async get() { throw new Error("CDN unavailable"); } },
  );
  assert.equal(cover, null);
});

test("TikTok preview has a hard timeout even if the HTTP client never settles", async () => {
  const started = Date.now();
  const cover = await fetchTikTokThumbnail(
    ["https://cdn.example/hanging.jpg"],
    { async get() { return new Promise(() => {}); } },
    { timeout: 10 },
  );
  assert.equal(cover, null);
  assert.ok(Date.now() - started < 1000);
});

test("status edits call the shared resolver rather than retrying TikWM on the same host", () => {
  const source = fs.readFileSync(new URL("../mias/precious-anime-edits.cjs", import.meta.url), "utf8");
  assert.match(source, /import\('\.\/features\/tiktok\.js'\)/);
  assert.match(source, /fetchTikTokInfo\(videoUrl\)/);
  assert.doesNotMatch(source, /tikwm-lite/);
});

test("the .tt preview uses bounded thumbnails and does not report a progress timer as a provider failure", () => {
  const source = fs.readFileSync(new URL("../mias/index.js", import.meta.url), "utf8");
  assert.match(source, /fetchTikTokThumbnail\(_coverCandidates, axios/);
  assert.doesNotMatch(source, /download provider never answered/);
  assert.match(source, /TikTok is still processing this request/);
});
