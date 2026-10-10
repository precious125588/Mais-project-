import { test } from "node:test";
import assert from "node:assert/strict";
import { bulkModeId, downloadTikTokMedia, runTikTokBulk, formatBulkSummary, BULK_MAX_LINKS } from "../mias/features/ttBulk.js";

const mp4 = () => { const b = Buffer.alloc(8000); b.write("ftyp", 4, "latin1"); return b; };
const payloadFor = (url) => {
  if (url.includes("/ok")) return { data: { hdplay: "https://cdn.test/hd.mp4", play: "https://cdn.test/sd.mp4", music: "https://cdn.test/a.mp3" } };
  if (url.includes("sdonly")) return { data: { play: "https://cdn.test/sd.mp4" } };
  if (url.includes("badfile")) return { data: { hdplay: "https://cdn.test/bad.mp4" } };
  return { data: {} };
};
function mocks({ calls = [], badFile = false } = {}) {
  const fetchImpl = async (u) => {
    calls.push(decodeURIComponent(u));
    const json = payloadFor(decodeURIComponent(u));
    return { ok: true, status: 200, json: async () => json };
  };
  const axiosImpl = {
    get: async (u) => {
      calls.push("GET " + u);
      if (badFile) return { data: Buffer.alloc(8000) };
      return { data: mp4() };
    },
  };
  return { fetchImpl, axiosImpl };
}

test("bulk format defaults to HD video, and honours explicit formats", () => {
  assert.equal(bulkModeId(""), "1.3");
  assert.equal(bulkModeId("audio"), "2.1");
  assert.equal(bulkModeId("sticker"), "3.1");
  assert.equal(bulkModeId("1.1"), "1.1");
});

test("one provider request per link and the exact HD file is fetched", async () => {
  const calls = [];
  const { fetchImpl, axiosImpl } = mocks({ calls });
  const sent = [];
  const r = await runTikTokBulk({
    urls: ["https://tiktok.com/ok1", "https://tiktok.com/nothing"],
    modeId: "1.3",
    send: async (x) => sent.push(x),
    deps: { fetchImpl, axiosImpl },
  });
  const providerCalls = calls.filter((c) => c.includes("tikwm.com"));
  assert.equal(providerCalls.length, 2, "exactly one provider request per link");
  assert.ok(calls.some((c) => c === "GET https://cdn.test/hd.mp4"), "HD file requested");
  assert.equal(r.sent, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.failures[0].index, 2);
  assert.match(r.failures[0].reason, /no media/i);
});

test("no quality substitution: HD requested but only SD exists -> clear failure", async () => {
  const { fetchImpl, axiosImpl } = mocks();
  await assert.rejects(
    downloadTikTokMedia("https://tiktok.com/sdonly", "1.3", { fetchImpl, axiosImpl }),
    /No video file is available in format 1\.3/
  );
});

test("a non-MP4 download is rejected with a reason", async () => {
  const { fetchImpl, axiosImpl } = mocks({ badFile: true });
  const r = await runTikTokBulk({
    urls: ["https://tiktok.com/badfile"], modeId: "1.3", send: async () => {}, deps: { fetchImpl, axiosImpl },
  });
  assert.equal(r.sent, 0);
  assert.match(r.failures[0].reason, /not a valid MP4|too small/);
});

test("max links cap and summary text", async () => {
  const urls = Array.from({ length: BULK_MAX_LINKS + 2 }, (_, i) => `https://tiktok.com/ok${i}`);
  const { fetchImpl, axiosImpl } = mocks();
  const r = await runTikTokBulk({ urls, modeId: "1.3", send: async () => {}, deps: { fetchImpl, axiosImpl } });
  assert.equal(r.total, BULK_MAX_LINKS);
  assert.equal(r.skipped, 2);
  assert.match(formatBulkSummary(r), /Batch done!.*sent.*failed/);
});
