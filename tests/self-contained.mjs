// No-import, no-bundler test harness. Stubs axios globally before
// importing the lib modules. Uses node:test for proper TAP output.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// 1) Stub @whiskeysockets/baileys so universalButtons can import it.
register("./baileys-stub-loader.js", import.meta.url);

// 2) Stub axios as a global BEFORE the lib files grab it.
globalThis.axios = {
  post: async (url, body, cfg) => {
    // Slow the chain intentionally so each provider produces a real error
    await new Promise(r => setTimeout(r, 5));
    const err = new Error("simulated network failure for " + url);
    err.code = "ECONNREFUSED";
    throw err;
  },
};

// 3) Now import the real production files.
const registry   = await import("../lib/pickerRegistry.js");
const buttons    = await import("../lib/universalButtons.js");
const videoFix   = await import("../lib/videoFix.js");
const shazamFix  = await import("../lib/shazamFix.js");

// ── helpers ────────────────────────────────────────────────────────────────
function makeSock(opts = {}) {
  const sent = [];
  return {
    user: { id: "2349079633136:1@s.whatsapp.net" },
    sendMessage: async (jid, content, sendOpts) => {
      sent.push({ jid, content, sendOpts });
      return { key: { id: "ms_" + sent.length, remoteJid: jid, participant: "bot@s.whatsapp.net" } };
    },
    relayMessage: async () => { throw new Error("relay_forced_throw"); },
    sent,
    ...opts,
  };
}

// ═══ picker registry ═══════════════════════════════════════════════════════
test("two pending pickers in same chat do NOT cross-fire", () => {
  const jid = "2349079633136@s.whatsapp.net";
  const sendPlay   = { key: { id: "PLAY_CARD", remoteJid: jid, participant: "bot@s.whatsapp.net" } };
  const sendMovie  = { key: { id: "MOVIE_CARD", remoteJid: jid, participant: "bot@s.whatsapp.net" } };
  registry.register({ jid, sent: sendPlay,  kind: "play",  payload: { v: "A" } });
  registry.register({ jid, sent: sendMovie, kind: "movie", payload: { v: "B" } });

  const replyForMovie = {
    key: { remoteJid: jid, participant: "2349079633136@s.whatsapp.net" },
    message: { extendedTextMessage: { text: "1", contextInfo: { stanzaId: "MOVIE_CARD", participant: "bot@s.whatsapp.net" } } },
  };
  const gotMovie = registry.consume(jid, replyForMovie);
  assert.equal(gotMovie?.kind, "movie", "Movie picker should claim this '1'");
  assert.equal(gotMovie?.payload?.v, "B");

  const replyForPlay = {
    key: { remoteJid: jid, participant: "2349079633136@s.whatsapp.net" },
    message: { extendedTextMessage: { text: "1", contextInfo: { stanzaId: "PLAY_CARD", participant: "bot@s.whatsapp.net" } } },
  };
  const gotPlay = registry.consume(jid, replyForPlay);
  assert.equal(gotPlay?.kind, "play", "Play picker should claim its OWN '1'");
});

test("bare reply (no quote) falls back to most-recent picker", () => {
  const jid = "2349000000002@s.whatsapp.net";
  const sent = { key: { id: "ABC", remoteJid: jid, participant: "bot@s.whatsapp.net" } };
  registry.register({ jid, sent, kind: "movie", payload: { x: 1 } });
  const reply = { key: { remoteJid: jid, participant: "2349000000002@s.whatsapp.net" }, message: { conversation: "1" } };
  assert.equal(registry.consume(jid, reply)?.kind, "movie");
});

test("expired picker (older than 10 minutes) is dropped", async () => {
  const jid = "2349000000003@s.whatsapp.net";
  const sent = { key: { id: "OLD", remoteJid: jid, participant: "bot@s.whatsapp.net" } };
  const entry = registry.register({ jid, sent, kind: "ytmate" });
  entry.ts = Date.now() - 11 * 60 * 1000;
  const reply = { key: { remoteJid: jid, participant: "2349000000003@s.whatsapp.net" }, message: { extendedTextMessage: { text: "1", contextInfo: { stanzaId: "OLD", participant: "bot@s.whatsapp.net" } } } };
  assert.equal(registry.consume(jid, reply), null);
});

// ═══ universal buttons ═════════════════════════════════════════════════════
test("Open-Categories button still works on relay-failing clients (text fallback)", async () => {
  const sock = makeSock();
  const res = await buttons.sendInteractiveCard(
    sock, "2349000000004@s.whatsapp.net",
    "Tap a category",
    { header: "PLAYER", footer: "by PRECIOUS",
      buttons: [{ text: "Open Categories", id: "open" }] }
  );
  assert.ok(res.ok);
  // relayShouldThrow forces the textFallback path on every run
  assert.equal(res.mode, "textFallback");
  assert.equal(sock.sent.length, 1);
  assert.match(sock.sent[0].content.text, /Open Categories/);
});

test("List card falls back to numbered text", async () => {
  const sock = makeSock();
  const res = await buttons.sendListCard(
    sock, "2349000000005@s.whatsapp.net",
    "Choose:",
    [{ title: "Songs", rows: [{ title: "Latest", id: "latest", description: "trending" }] }],
    { title: "MENU", buttonText: "Open" }
  );
  assert.ok(res.ok);
  assert.equal(res.mode, "textFallback");
});

// ═══ video integrity ════════════════════════════════════════════════════════
test("HTML/error payload rejected (no more 'corrupted' video)", () => {
  const html = Buffer.from("<!doctype html><html><body>not a real video</body></html>", "utf8");
  assert.equal(videoFix.looksLikeBinaryMedia(html), false);
  const real = Buffer.alloc(64 * 1024, 0);
  real[4] = 0x66; real[5] = 0x74; real[6] = 0x79; real[7] = 0x70;
  assert.equal(videoFix.looksLikeBinaryMedia(real), true);
});

test("sendVideoRobust falls back to .mp4 document when WA rejects the video", async () => {
  let sentVideoCount = 0, sentDocCount = 0;
  const sock = {
    sendMessage: async (jid, content) => {
      if (content.video) { sentVideoCount++; throw new Error("client cant render"); }
      if (content.document) { sentDocCount++; return { key: { id: "doc_ok" } }; }
      throw new Error("unexpected");
    },
  };
  const real = Buffer.alloc(64 * 1024, 0);
  real[4] = 0x66; real[5] = 0x74; real[6] = 0x79; real[7] = 0x70;
  const out = await videoFix.sendVideoRobust(sock, "2349@s.whatsapp.net", real, "🎬 test");
  assert.equal(out.ok, true);
  assert.equal(out.mode, "documentFallback");
  assert.equal(sentVideoCount, 1);
  assert.equal(sentDocCount, 1);
});

test("sendVideoRobust refuses HTML buffer with NOT_VIDEO_MEDIA", async () => {
  const sock = makeSock();
  const html = Buffer.from("<html><body>oops</body></html>");
  await assert.rejects(videoFix.sendVideoRobust(sock, "2349@s.whatsapp.net", html), /NOT_VIDEO_MEDIA/);
});

// ═══ shazam robustness ═════════════════════════════════════════════════════
test("shazam: tiny audio returns too_short", async () => {
  const log = () => {};
  const r = await shazamFix.shazamIdentify(Buffer.alloc(1024), "audio/ogg", log);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too_short");
});

test("shazam: every provider failure is logged (no silent ❌)", async () => {
  const lines = [];
  const log = (...m) => lines.push(m.join(" "));
  const r = await shazamFix.shazamIdentify(Buffer.alloc(64 * 1024, 1), "audio/ogg", log);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "all_providers_failed");
  for (const provider of ["prexzy","siputzx","ryzendesu","gifted","widipe","nexoracle","audd"]) {
    assert.ok(lines.some(l => l.includes(provider)), `must log ${provider} failure`);
  }
});
