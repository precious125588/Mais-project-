import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fetchTikTokInfo,
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

test("status edits call the shared resolver rather than retrying TikWM on the same host", () => {
  const source = fs.readFileSync(new URL("../mias/precious-anime-edits.cjs", import.meta.url), "utf8");
  assert.match(source, /import\('\.\/features\/tiktok\.js'\)/);
  assert.match(source, /fetchTikTokInfo\(videoUrl\)/);
  assert.doesNotMatch(source, /tikwm-lite/);
});
