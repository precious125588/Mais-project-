import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("disk guard exposes usable space and classifies ENOSPC", () => {
  assert.ok(getMediaLimitBytes() > 0);
  assert.ok(getDiskSpace()?.freeBytes > 0);
  assert.equal(isNoSpaceError(Object.assign(new Error("disk full"), { code: "ENOSPC" })), true);
});