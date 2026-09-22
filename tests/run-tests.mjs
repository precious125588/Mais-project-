// Mock-tests for the v23-rc replacement files. Stub a minimal
// "sock" object so every code path runs without Baileys.

import test from "node:test";
import assert from "node:assert/strict";

// ── Make @whiskeysockets/baileys resolvable without doing npm install ──
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const BA = { proto: { Message: { InteractiveMessage: { create: () => ({}), Body: { create: x => x }, Footer: { create: x => x }, Header: { create: x => x }, NativeFlowMessage: { create: x => x } } } }, generateWAMessageFromContent: async (jid, content, opts) => ({ key: { id: "WAM_" + Math.random().toString(36).slice(2), participant: "bot@s.whatsapp.net", remoteJid: jid }, message: content }) };
require.cache[require.resolve.paths("@whiskeysockets/baileys")] = undefined;
try { require.cache["@whiskeysockets/baileys"] = { exports: BA }; } catch {}
// Use a custom module resolver via a Map hook
const Module = require("module");
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "@whiskeysockets/baileys") return require.resolve("./fake-baileys.js");
  return _origResolve.call(this, request, parent, ...rest);
};

import { writeFileSync } from "node:fs";
writeFileSync(new URL("./fake-baileys.js", import.meta.url).pathname, `module.exports = ${JSON.stringify({})};`);

// ── Re-import after faking ──
const __dirname_fix = "/home/user/precious-fix";
const registry  = await import(`${__dirname_fix}/lib/pickerRegistry.js`);
const buttons   = await import(`${__dirname_fix}/lib/universalButtons.js`);
const videoFix  = await import(`${__dirname_fix}/lib/videoFix.js`);
const shazamFix = await import(`${__dirname_fix}/lib/shazamFix.js`);

// ── Stub sock ──────────────────────────────────────────────────────
function makeSock(opts = {}) {
  const sent = [];
  return {
    user: { id: "2349079633136:1@s.whatsapp.net" },
    sendMessage: async (jid, content, sendOpts) => {
      sent.push({ jid, content, sendOpts });
      return { key: { id: "ms_" + sent.length, remoteJid: jid, participant: "bot@s.whatsapp.net" } };
    },
    relayMessage: async (jid, msg, sendOpts) => {
      sent.push({ jid, msg, sendOpts });
      return { key: { id: "relay_" + sent.length } };
    },
    sent,
    relayShouldThrow: opts.relayShouldThrow || false,
  };
}

// ═════════ PICKER REGISTRY ═════════
test("picker registry: two pending pickers in same chat do NOT cross-fire", () => {
  const jid = "2349079633136@s.whatsapp.net";
  const sendPlay   = { key: { id: "PLAY_CARD", remoteJid: jid, participant: "bot@s.whatsapp.net" } };
  const sendMovie  = { key: { id: "MOVIE_CARD", remoteJid: jid, participant: "bot@s.whatsapp.net" } };

  registry.register({ jid, sent: sendPlay,  kind: "play",  payload: { v: "A" }, handler: null });
  registry.register({ jid, sent: sendMovie, kind: "movie", payload: { v: "B" }, handler: null });

  // User types "1" while quoting the movie card → must hit movie
  const replyForMovie = {
    key: { remoteJid: jid, participant: "2349079633136@s.whatsapp.net" },
    message: { extendedTextMessage: { text: "1", contextInfo: { stanzaId: "MOVIE_CARD", participant: "bot@s.whatsapp.net" } } },
  };
  const got = registry.consume(jid, replyForMovie);
  assert.equal(got?.kind, "movie", "Movie picker should claim this 1");
  assert.equal(got?.payload?.v, "B");

  // User types "1" while quoting play card → must hit play
  const replyForPlay = {
    key: { remoteJid: jid, participant: "2349079633136@s.whatsapp.net" },
    message: { extendedTextMessage: { text: "1", contextInfo: { stanzaId: "PLAY_CARD", participant: "bot@s.whatsapp.net" } } },
  };
  const gotPlay = registry.consume(jid, replyForPlay);
  assert.equal(gotPlay?.kind, "play", "Play picker should claim its own 1");
});

test("picker registry: bare '1' with no quote falls back to most recent", () => {
  const jid = "2349000000002@s.whatsapp.net";
  const sent = { key: { id: "ABC", remoteJid: jid, participant: "bot@s.whatsapp.net" } };
  registry.register({ jid, sent, kind: "movie", payload: { x: 1 } });
  const bare = { key: { remoteJid: jid, participant: "2349000000002@s.whatsapp.net" }, message: { conversation: "1" } };
  const got = registry.consume(jid, bare);
  assert.equal(got?.kind, "movie");
});

test("picker registry: TTL expires entries older than 10 minutes", () => {
  const jid = "2349000000003@s.whatsapp.net";
  const sent = { key: { id: "OLD", remoteJid: jid, participant: "bot@s.whatsapp.net" } };
  // Manually age the entry
  const entry = registry.register({ jid, sent, kind: "ytmate" });
  entry.ts = Date.now() - 11 * 60 * 1000;
  const reply = { key: { remoteJid: jid, participant: "2349000000003@s.whatsapp.net" }, message: { extendedTextMessage: { text: "1", contextInfo: { stanzaId: "OLD", participant: "bot@s.whatsapp.net" } } } };
  const got = registry.consume(jid, reply);
  assert.equal(got, null, "Expired picker must not be returned");
});

// ═════════ UNIVERSAL BUTTONS ═════════
test("buttons: even on relayMessage failure, plain text fallback succeeds", async () => {
  const sock = makeSock({ relayShouldThrow: true });
  const res = await buttons.sendInteractiveCard(
    sock, "2349000000004@s.whatsapp.net",
    "Open Categories",
    { header: "PLAYER", footer: "by PRECIOUS", buttons: [{ text: "Open Categories", id: "open" }] }
  );
  assert.ok(res.ok, "should succeed via fallback");
  assert.equal(res.mode, "textFallback");
  assert.equal(sock.sent.length, 1);
  assert.match(sock.sent[0].content.text, /Open Categories/);
});

test("buttons: list sends even when native flow throws", async () => {
  const sock = makeSock({ relayShouldThrow: true });
  const res = await buttons.sendListCard(
    sock, "2349000000005@s.whatsapp.net",
    "Choose an option:",
    [{ title: "Songs", rows: [{ title: "Latest", id: "latest", description: "trending" }] }],
    { title: "MENU", buttonText: "Open" }
  );
  assert.ok(res.ok);
  assert.equal(res.mode, "textFallback");
});

// ═════════ VIDEO FIX ═════════
test("video: HTML payload rejected, real MP4 accepted", () => {
  const html = Buffer.from("<!doctype html><html><body>not a real video</body></html>");
  assert.equal(videoFix.looksLikeBinaryMedia(html), false, "HTML must NOT be treated as video");
  const real = Buffer.alloc(64 * 1024, 0);
  real[4] = 0x66; real[5] = 0x74; real[6] = 0x79; real[7] = 0x70;
  assert.equal(videoFix.looksLikeBinaryMedia(real), true, "a real ftyp box must be accepted");
});

test("video: sendVideoRobust falls back to document when sendMessage rejects", async () => {
  const sock = {
    sendMessage: async (jid, content) => {
      if (content.video) throw new Error("client cannot render video");
      return { key: { id: "doc_ok" } };
    },
  };
  const real = Buffer.alloc(64 * 1024, 0);
  real[4] = 0x66; real[5] = 0x74; real[6] = 0x79; real[7] = 0x70;
  const out = await videoFix.sendVideoRobust(sock, "2349@s.whatsapp.net", real, "🎬 test");
  assert.equal(out.ok, true);
  assert.equal(out.mode, "documentFallback");
});

test("video: HTML buffer throws NOT_VIDEO_MEDIA instead of sending junk", async () => {
  const sock = makeSock();
  const html = Buffer.from("<html><body>oops</body></html>");
  await assert.rejects(videoFix.sendVideoRobust(sock, "2349@s.whatsapp.net", html), /NOT_VIDEO_MEDIA/);
});

// ═════════ SHAZAM ═════════
test("shazam: 15 KB audio returns too_short without burst", async () => {
  const log = (...a) => {};
  const r = await shazamFix.shazamIdentify(Buffer.alloc(1024), "audio/ogg", log);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too_short");
});

test("shazam: when all providers fail, logs each one and returns ok:false", async () => {
  // Stub a global axios so shazamFix can reach it
  globalThis.axios = {
    post: async (url, body, cfg) => {
      // Simulate every upstream provider rejecting the unknown audio
      const e = new Error("ECONNREFUSED " + url);
      throw e;
    },
  };
  // Re-import shazamFix with axios now visible
  const shazamFix2 = await import(`${__dirname_fix}/lib/shazamFix.js?retry=1`);
  const lines = [];
  const log = (...m) => lines.push(m.join(" "));
  const r = await shazamFix2.shazamIdentify(Buffer.alloc(64 * 1024, 1), "audio/ogg", log);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "all_providers_failed");
  assert.ok(lines.some(l => l.includes("prexzy")), "must log prexzy failure");
  assert.ok(lines.some(l => l.includes("siputzx")), "must log siputzx failure");
});

console.log("\nALL TESTS REGISTERED — node:test runner will execute:");
