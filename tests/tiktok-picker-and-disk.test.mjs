import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchTikTokInfo,
  normalizeTikTokMode,
  parseTikTokMode,
  selectTikTokUrl,
} from "../mias/features/tiktok.js";
import {
  getDiskSpace,
  getMediaLimitBytes,
  isNoSpaceError,
} from "../mias/lib/diskGuard.js";

test("TikTok picker accepts normal and prefixed choices", () => {
  assert.equal(normalizeTikTokMode("1.3"), "1.3");
  assert.equal(normalizeTikTokMode(".1.3"), "1.3");
  assert.equal(normalizeTikTokMode("*2.3*"), "2.3");
  assert.equal(parseTikTokMode("hd")?.id, "1.3");
  assert.equal(parseTikTokMode("sticker")?.id, "3.1");
});

test("TikTok picker chooses the requested media URL", () => {
  const info = {
    videoHd: "https://cdn.example/hd.mp4",
    videoSd: "https://cdn.example/sd.mp4",
    videoWatermark: "https://cdn.example/wm.mp4",
    audio: "https://cdn.example/audio.mp3",
  };
  assert.equal(selectTikTokUrl(info, parseTikTokMode("1.3")), info.videoHd);
  assert.equal(selectTikTokUrl(info, parseTikTokMode("1.1")), info.videoSd);
  assert.equal(selectTikTokUrl(info, parseTikTokMode("2.3")), info.audio);
  assert.equal(selectTikTokUrl(info, parseTikTokMode("3.1")), info.videoHd);
});

test("TikTok never substitutes another quality or watermark", () => {
  const sdOnly = { videoSd: "https://cdn.example/sd.mp4", audio: "https://cdn.example/a.mp3" };
  assert.equal(selectTikTokUrl(sdOnly, parseTikTokMode("1.3")), null);
  assert.equal(selectTikTokUrl(sdOnly, parseTikTokMode("1.6")), null);
  assert.equal(selectTikTokUrl(sdOnly, parseTikTokMode("1.1")), "https://cdn.example/sd.mp4");
});

test("TikTok info makes one provider request and no second link", async () => {
  const calls = [];
  const failing = async (url) => { calls.push(url); return { ok: false, status: 500, json: async () => ({}) }; };
  await assert.rejects(fetchTikTokInfo("https://vm.tiktok.com/abc/", failing), /HTTP 500/);
  assert.equal(calls.length, 1);
});

test("disk guard exposes usable space and classifies ENOSPC", () => {
  assert.ok(getMediaLimitBytes() > 0);
  assert.ok(getDiskSpace()?.freeBytes > 0);
  assert.equal(isNoSpaceError(Object.assign(new Error("disk full"), { code: "ENOSPC" })), true);
});