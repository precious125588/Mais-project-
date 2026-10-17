import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = (p) => fs.readFileSync(path.join(ROOT, "mias", p), "utf8");
const SPOT = SRC("features/spotifyCommands.js");
const SPOT_CODE = SPOT.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const HAVE_DEPS = fs.existsSync(path.join(ROOT, "mias", "node_modules", "axios", "package.json"));
const SKIP = HAVE_DEPS ? false : "mias/node_modules (axios) not installed";

// ---- source-level checks ----
test("spotify video: Spotify provider first, YouTube only as the fallback", () => {
  const sp = SPOT_CODE.indexOf("const vbuf") === -1 ? SPOT_CODE.indexOf("let vbuf") : SPOT_CODE.indexOf("let vbuf");
  assert.ok(sp > 0, "video branch present");
  const branch = SPOT_CODE.slice(sp, SPOT_CODE.indexOf("const a = await getAudioFor", sp));
  assert.ok(branch.indexOf("fetchVideoBuf(entry.videoUrl)") < branch.indexOf("youTubeFor(entry)"), "Spotify video tried before YouTube");
  assert.ok(branch.includes("if (!vbuf) {"), "YouTube runs only when Spotify gave no video");
  assert.ok(!/ytSearch|findVideoUrl/.test(SPOT_CODE), "no ctx.ytSearch dependency");
});

test("audio: Spotify providers come before the YouTube audio fallback", () => {
  const body = SPOT_CODE.slice(SPOT_CODE.indexOf("async function getAudioFor"), SPOT_CODE.indexOf("async function deliver"));
  assert.ok(body.indexOf("iterateSources(entry.url") > 0, "Spotify providers used");
  assert.ok(body.indexOf("iterateSources(entry.url") < body.indexOf("youTubeFor(entry)"), "YouTube only after Spotify");
  assert.ok(body.indexOf("youTubeFor(entry)") < body.indexOf("findYouTubeAudio(yt)"), "YouTube audio is last");
  assert.ok(body.indexOf("throw new Error") > body.indexOf("findYouTubeAudio(yt)"), "error only when both fail");
});

test("video is made WhatsApp-playable by makeWhatsAppVideo (Spotify only)", () => {
  assert.ok(/export async function makeWhatsAppVideo/.test(SPOT));
  assert.ok(/return makeWhatsAppVideo\(buf\)/.test(SPOT));
  assert.ok(/makeWhatsAppVideo\(muxed\)/.test(SPOT));
  assert.ok(!/prepareTikTokVideo/.test(SPOT_CODE), "Spotify no longer depends on the shared TikTok normalizer");
});

test("option 3 never gets a ✅ reaction; options 1 and 2 keep it", () => {
  assert.ok(SPOT.includes('if (Number(text) !== 3) { try { await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }); } catch {} }'));
});

test("tiktok 1.3 HD mode is still defined as before (tiktok code untouched)", () => {
  assert.ok(SRC("features/tiktok.js").includes('"1.3": { kind: "video", quality: "hd", document: false, watermark: false }'));
});

// ---- functional: real module in an isolated copy, stubbed api.js ----
let mod, tmp, server, base, FX = {};
const TRACK = "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b";
const YT = "https://www.youtube.com/watch?v=4NRXx6U8ABQ";
const GROUP = "120363000000000000@g.us", USER = "2348000000000@s.whatsapp.net";

if (HAVE_DEPS) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spot-test-"));
  for (const d of ["features", "lib"]) fs.mkdirSync(path.join(tmp, d), { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ type: "module" }));
  fs.copyFileSync(path.join(ROOT, "mias/features/spotifyCommands.js"), path.join(tmp, "features/spotifyCommands.js"));
  fs.copyFileSync(path.join(ROOT, "mias/features/ttVideo.js"), path.join(tmp, "features/ttVideo.js"));
  fs.copyFileSync(path.join(ROOT, "mias/lib/portableVideo.cjs"), path.join(tmp, "lib/portableVideo.cjs"));
  fs.writeFileSync(path.join(tmp, "api.js"), "export async function nxGet(p, q) { return globalThis.__nx ? globalThis.__nx(p, q) : { ok: false }; }\nexport async function prexzyGet() { return { ok: false }; }\n");
  fs.symlinkSync(path.join(ROOT, "mias", "node_modules"), path.join(tmp, "node_modules"), "dir");
  const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  // Non-faststart MP4 (moov at the end), like a raw provider file, with an audio track.
  ff(["-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "mp4", path.join(tmp, "v.mp4")]);
  ff(["-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-c:a", "libmp3lame", "-b:a", "128k", path.join(tmp, "a.mp3")]);
  // Video-only MP4 (like a YouTube provider link), to prove the Spotify audio is muxed in.
  ff(["-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-f", "mp4", path.join(tmp, "vo.mp4")]);
  FX.v = fs.readFileSync(path.join(tmp, "v.mp4"));
  FX.vo = fs.readFileSync(path.join(tmp, "vo.mp4"));
  FX.a = fs.readFileSync(path.join(tmp, "a.mp3"));
  // A different tone, so the test can tell Spotify's audio from YouTube's audio by bytes.
  ff(["-f", "lavfi", "-i", "sine=frequency=660:duration=3", "-c:a", "libmp3lame", "-b:a", "128k", path.join(tmp, "ya.mp3")]);
  FX.ya = fs.readFileSync(path.join(tmp, "ya.mp3"));
  FX.c = Buffer.alloc(3000, 7);
  server = http.createServer((req, res) => {
    const map = { "/v.mp4": ["video/mp4", FX.v], "/vo.mp4": ["video/mp4", FX.vo], "/a.mp3": ["audio/mpeg", FX.a], "/ya.mp3": ["audio/mpeg", FX.ya], "/c.jpg": ["image/jpeg", FX.c] };
    const e = map[req.url];
    if (!e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": e[0], "content-length": e[1].length });
    res.end(e[1]);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  mod = await import(pathToFileURL(path.join(tmp, "features/spotifyCommands.js")).href);
  // Odd-size MPEG-4 (not H.264): must come out as H.264 yuv420p with even dimensions.
  ff(["-f", "lavfi", "-i", "testsrc=duration=2:size=321x241:rate=25", "-c:v", "mpeg4", "-an", "-f", "mp4", path.join(tmp, "mp4v.mp4")]);
  FX.mp4v = fs.readFileSync(path.join(tmp, "mp4v.mp4"));
  // Only the local fixture server is reachable in tests; the public providers fail fast.
  const axiosLib = (await import(pathToFileURL(path.join(ROOT, "mias/node_modules/axios/index.js")).href)).default;
  const realGet = axiosLib.get.bind(axiosLib);
  axiosLib.get = (url, cfg) => (String(url).startsWith(base) ? realGet(url, cfg) : Promise.reject(new Error("offline in tests")));
}
after(() => { if (server) { server.closeAllConnections?.(); server.close(); } });

test("parseSpotifyPayload picks the Spotify video link and the audio link", { skip: SKIP }, () => {
  const out = mod.parseSpotifyPayload({ status: true, result: { title: "T", artist: "A", duration: 200, cover: "https://i.scdn.co/image/abc", url: "https://cdn.example.com/a.mp3", video: "https://cdn.example.com/canvas.mp4" } });
  assert.equal(out.audioUrl, "https://cdn.example.com/a.mp3");
  assert.equal(out.videoUrl, "https://cdn.example.com/canvas.mp4");
  assert.equal(out.meta.title, "T");
});

test("parseSpotifyPayload returns no video for the live Nexray audio-only shape", { skip: SKIP }, () => {
  const out = mod.parseSpotifyPayload({ status: true, author: "@nexray", result: { title: "Blinding Lights", artist: "The Weeknd", url: "https://rapid.spotidown.app/v2?token=abc" } });
  assert.equal(out.audioUrl, "https://rapid.spotidown.app/v2?token=abc");
  assert.equal(out.videoUrl, "");
});

test("parseSpotifyPayload never treats an image or Spotify page as the video", { skip: SKIP }, () => {
  const out = mod.parseSpotifyPayload({ status: true, result: { title: "T", url: "https://cdn.example.com/a.mp3", video: "https://i.scdn.co/image/abc.jpg", canvas: "https://open.spotify.com/track/x" } });
  assert.equal(out.videoUrl, "");
});

test("audioFormat accepts real MP3 bytes and rejects an HTML error page", { skip: SKIP }, () => {
  assert.equal(mod.audioFormat(Buffer.concat([Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00"), Buffer.alloc(6000)])), "mp3");
  assert.equal(mod.audioFormat(Buffer.from("<html>" + "x".repeat(6000))), null);
});

test("playable: an H.264 MP4 is stream-copied with faststart (fast path)", { skip: SKIP }, async () => {
  const out = await mod.makeWhatsAppVideo(FX.v);
  assert.ok(Buffer.isBuffer(out) && out.length > 10000, "output produced");
  assert.equal(out.toString("latin1", 4, 8), "ftyp");
  assert.ok(out.indexOf("moov") > 0 && out.indexOf("moov") < out.indexOf("mdat"), "moov before mdat (faststart)");
  const codecs = probeCodecs(out);
  assert.ok(codecs.includes("h264"), "H.264 video: " + codecs.join(","));
  assert.ok(codecs.includes("aac"), "AAC audio: " + codecs.join(","));
});

test("playable: a non-H.264 MP4 with odd size is re-encoded to H.264 yuv420p with even size", { skip: SKIP }, async () => {
  const out = await mod.makeWhatsAppVideo(FX.mp4v);
  assert.ok(Buffer.isBuffer(out) && out.length > 10000, "output produced");
  const f = path.join(tmp, `chk-${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(f, out);
  const info = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,width,height", "-of", "json", f]).toString();
  const st = JSON.parse(info).streams[0];
  assert.equal(st.codec_name, "h264");
  assert.equal(st.pix_fmt, "yuv420p");
  assert.equal(st.width, 320);
  assert.equal(st.height, 240);
});

test("playable: garbage or non-MP4 input is rejected instead of sent", { skip: SKIP }, async () => {
  assert.equal(await mod.makeWhatsAppVideo(Buffer.alloc(50000, 1)), null);
  assert.equal(await mod.makeWhatsAppVideo(Buffer.from("<html>" + "x".repeat(20000))), null);
});

// ---- end-to-end through the real command + reply listener ----
function harness({ spotifyVideo, youtube, spotifyAudioBroken = false }) {
  globalThis.__ytAudioCalls = 0;
  globalThis.__nx = async (p) => {
    if (p === "/search/spotify") return { ok: true, data: { result: [{ url: TRACK }] }, result: [{ url: TRACK }] };
    if (p === "/search/youtube") {
      const list = youtube ? [{ title: "Test Artist - Test Song (Official Video)", url: YT }] : [{ title: "Unrelated clip", url: YT }];
      return { ok: true, result: list };
    }
    if (p === "/downloader/spotify") {
      const result = { title: "Test Song", artist: "Test Artist", duration: 200, cover: `${base}/c.jpg`, url: spotifyAudioBroken ? `${base}/missing.mp3` : `${base}/a.mp3` };
      if (spotifyVideo) result.video = `${base}/v.mp4`;
      return { ok: true, data: { status: true, result } };
    }
    return { ok: false };
  };
  let command = null;
  const ctx = {
    cmd: (names, opts, fn) => { command = fn; },
    sendReply: async (sock, m, text) => sock.sendMessage(m.key.remoteJid, { text }, { quoted: m }),
    react: async (sock, msg, emoji) => sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }),
    CONFIG: { BOT_NAME: "MIAS", PREFIX: "." },
    dcGet: async (p) => {
      if (p === "/download/ytmp3") { globalThis.__ytAudioCalls++; return youtube ? { ok: true, data: { status: 200, success: true, result: { download_url: `${base}/ya.mp3` } } } : { ok: false }; }
      if (p === "/download/ytmp4" && youtube) return { ok: true, data: { status: 200, success: true, result: { download_url: `${base}/vo.mp4`, quality: "360p" } } };
      return { ok: false };
    },
    prexzyGet: async () => ({ ok: false }),
    __miasMapSet() {}, __miasMapDelete() {},
    getSender: (m) => m.key.participant || m.key.remoteJid,
    isPrivateBlocked: () => false,
    transcodeAudio: async (b) => b, voiceBuffer: async (b) => b,
  };
  mod.installSpotifyCommands(ctx);
  const sock = { sent: [], handler: null, ev: { on(evt, fn) { if (evt === "messages.upsert") sock.handler = fn; } },
    async sendMessage(jid, content) { sock.sent.push({ jid, content }); return { key: { id: "CARD" + sock.sent.length, remoteJid: jid } }; } };
  const cmdMsg = { key: { remoteJid: GROUP, id: "CMD1", participant: USER, fromMe: false }, message: { conversation: ".spotify" } };
  return { sock, run: () => command(sock, cmdMsg, [TRACK]) };
}
const reaction = (sock, id, emoji) => sock.sent.some((s) => s.content?.react?.key?.id === id && s.content.react.text === emoji);
const replyMsg = (text, id) => ({ messages: [{ key: { remoteJid: GROUP, id, participant: USER, fromMe: false }, message: { conversation: text } }] });
const probeCodecs = (buf) => {
  const f = path.join(tmp, `codecs-${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(f, buf);
  return execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", f]).toString().split("\n").filter(Boolean);
};
const probeStreams = (buf) => {
  const f = path.join(tmp, `probe-${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(f, buf);
  return execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", f]).toString().split("\n").filter(Boolean);
};

test("reply 1 sends the MP3 and gets a ✅", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: true, youtube: true });
  await h.run();
  await h.sock.handler(replyMsg("1", "R1"));
  assert.ok(h.sock.sent.some((s) => s.content?.audio && s.content.mimetype === "audio/mpeg"), "audio sent");
  assert.ok(reaction(h.sock, "R1", "✅"), "✅ on option 1");
});

test("reply 3 uses the Spotify provider video first and gets no ✅", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: true, youtube: true });
  await h.run();
  await h.sock.handler(replyMsg("3", "R3"));
  const vid = h.sock.sent.find((s) => s.content?.video);
  assert.ok(vid, "video sent");
  assert.equal(vid.content.mimetype, "video/mp4");
  assert.equal(vid.content.video.toString("latin1", 4, 8), "ftyp");
  assert.ok(!reaction(h.sock, "R3", "✅"), "no ✅ on option 3");
  assert.ok(reaction(h.sock, "R3", "⏳"), "progress ⏳ still shown");
});

test("reply 3 with no Spotify video falls back to YouTube, muxed with Spotify audio", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: false, youtube: true });
  await h.run();
  await h.sock.handler(replyMsg("3", "R3c"));
  const vid = h.sock.sent.find((s) => s.content?.video);
  assert.ok(vid, "YouTube-fallback video sent");
  assert.equal(vid.content.video.toString("latin1", 4, 8), "ftyp");
  assert.ok(probeStreams(vid.content.video).includes("audio"), "Spotify audio present in the video");
  assert.equal(globalThis.__ytAudioCalls, 0, "YouTube audio not used while Spotify audio works");
  assert.ok(!reaction(h.sock, "R3c", "✅"), "no ✅ on option 3");
});

test("reply 3 with no Spotify video and no YouTube match says video not available, no ✅", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: false, youtube: false });
  await h.run();
  await h.sock.handler(replyMsg("3", "R3b"));
  assert.ok(h.sock.sent.some((s) => s.content?.text && s.content.text.includes("Video not available")), "not-available text");
  assert.ok(!h.sock.sent.some((s) => s.content?.video), "no video sent");
  assert.ok(!reaction(h.sock, "R3b", "✅"), "no ✅ on option 3");
});

test("audio: option 1 sends Spotify's own MP3 and never calls YouTube audio", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: false, youtube: true });
  await h.run();
  await h.sock.handler(replyMsg("1", "A1"));
  const aud = h.sock.sent.find((s) => s.content?.audio);
  assert.ok(aud, "audio sent");
  assert.equal(Buffer.compare(aud.content.audio, FX.a), 0, "Spotify's audio bytes");
  assert.equal(globalThis.__ytAudioCalls, 0, "YouTube audio not called");
  assert.ok(reaction(h.sock, "A1", "✅"), "✅ on option 1");
});

test("audio: option 2 voice note uses Spotify's audio, not YouTube's", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: false, youtube: true });
  await h.run();
  await h.sock.handler(replyMsg("2", "A2s"));
  const ptt = h.sock.sent.find((s) => s.content?.audio && s.content.ptt);
  assert.ok(ptt, "voice note sent");
  assert.equal(Buffer.compare(ptt.content.audio, FX.a), 0, "Spotify's audio bytes");
  assert.equal(globalThis.__ytAudioCalls, 0, "YouTube audio not called");
});

test("audio: YouTube audio is used only when no Spotify provider gives audio", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: false, youtube: true, spotifyAudioBroken: true });
  await h.run();
  await h.sock.handler(replyMsg("1", "A4"));
  const aud = h.sock.sent.find((s) => s.content?.audio);
  assert.ok(aud, "fallback audio sent");
  assert.equal(Buffer.compare(aud.content.audio, FX.ya), 0, "YouTube audio as the fallback");
  assert.ok(globalThis.__ytAudioCalls >= 1, "YouTube audio tried after Spotify failed");
  assert.ok(reaction(h.sock, "A4", "✅"), "✅ on option 1");
});

test("audio: video fallback uses YouTube audio only when Spotify audio is gone", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: false, youtube: true, spotifyAudioBroken: true });
  await h.run();
  await h.sock.handler(replyMsg("3", "V4"));
  const vid = h.sock.sent.find((s) => s.content?.video);
  assert.ok(vid, "video sent");
  assert.ok(probeStreams(vid.content.video).includes("audio"), "audio present");
  assert.ok(globalThis.__ytAudioCalls >= 1, "YouTube audio used as the fallback");
  assert.ok(!reaction(h.sock, "V4", "✅"), "no ✅ on option 3");
});

test("audio: when Spotify and YouTube both give no audio, option 1 shows ❌ with the reason", { skip: SKIP }, async () => {
  const h = harness({ spotifyVideo: false, youtube: false, spotifyAudioBroken: true });
  await h.run();
  await h.sock.handler(replyMsg("1", "A5"));
  assert.ok(!h.sock.sent.some((s) => s.content?.audio), "no audio sent");
  assert.ok(reaction(h.sock, "A5", "❌"), "❌ on failure");
  assert.ok(h.sock.sent.some((s) => s.content?.text && s.content.text.includes("Spotify download failed")), "error reason sent");
});
