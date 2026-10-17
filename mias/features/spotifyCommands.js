// Spotify command: music card (cover, title, artist, duration) and a quoted 1/2/3 picker.
// Built the same way as the .play card, but with its own pending store and reply
// listener, so .play / .play2 code is not touched.
//   1 = music file (MP3)   2 = voice note   3 = video file (or "video not available")
import axios from "axios";
import { nxGet } from "../api.js";

const SPOT_TTL = 20 * 60 * 1000;          // card stays pickable for 20 minutes
const SPOT_FIND_BUDGET_MS = 75 * 1000;    // max time spent finding a working provider
const SPOT_PENDING = new Map();           // card message id -> pick entry
const SPOT_BOUND = new WeakSet();         // sockets that already have the reply listener
const UA = { "User-Agent": "Mozilla/5.0" };
const SPOTIFY_TRACK_RE = /https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/[A-Za-z0-9]+/i;
// Audio links must not be images, Spotify/YouTube pages, or CDN artwork.
const NOT_AUDIO_RE = /scdn\.co|ytimg|spotify\.com|youtube\.com|youtu\.be|\.(jpe?g|png|webp|gif)(\?|$)/i;

const chatKey = (j) => String(j || "").replace(/:\d+(?=@)/, "").toLowerCase();
const fmtDur = (sec) => (!sec ? "N/A" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`);
const normTitle = (s) => String(s || "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

// Duration: values above 10000 are milliseconds (Spotify ms), smaller are seconds.
function parseDurationSec(v) {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) { const n = Math.round(Number(s)); return n > 10000 ? Math.round(n / 1000) : n; }
  const parts = s.split(":").map(Number);
  if (parts.length >= 2 && parts.every(Number.isFinite)) return parts.reduce((a, b) => a * 60 + b, 0);
  return 0;
}

// Flatten a provider response into [key, value] pairs. Keys are lower-cased and
// arrays keep the key of their parent, so artists: ["A", "B"] yields ["artists","A"].
function walkPairs(o, key = "", depth = 0, out = []) {
  if (o == null || depth > 6) return out;
  if (typeof o === "string" || typeof o === "number") { out.push([key.toLowerCase(), String(o)]); return out; }
  if (Array.isArray(o)) { for (const x of o.slice(0, 30)) walkPairs(x, key, depth + 1, out); return out; }
  if (typeof o === "object") for (const [k, v] of Object.entries(o)) walkPairs(v, k, depth + 1, out);
  return out;
}
function pickOne(pairs, keys, test = () => true) {
  for (const k of keys) {
    const hit = pairs.find(([pk, pv]) => pk === k && pv.trim() && test(pv.trim()));
    if (hit) return hit[1].trim();
  }
  return "";
}
function pickAll(pairs, keys) {
  for (const k of keys) {
    const vals = [...new Set(pairs.filter(([pk, pv]) => pk === k && pv.trim() && !/^\d+$/.test(pv.trim())).map(([, pv]) => pv.trim()))];
    if (vals.length) return vals;
  }
  return [];
}

// Turn any provider JSON into { audioUrl, meta } or null when it has no audio link.
export function parseSpotifyPayload(data) {
  if (!data || typeof data !== "object") return null;
  if (data.status === false || data.success === false) return null;
  const pairs = walkPairs(data);
  const isAudioUrl = (v) => /^https?:\/\//i.test(v) && !NOT_AUDIO_RE.test(v);
  const audioUrl = pickOne(pairs, ["downloadlink", "download_url", "downloadurl", "download", "music", "audio", "audiourl", "mp3", "dlurl", "link", "url"], isAudioUrl);
  if (!audioUrl) return null;
  const title = pickOne(pairs, ["title", "name", "track", "songtitle", "trackname"], (v) => v.length < 300 && !/^https?:/i.test(v));
  const artist = pickAll(pairs, ["artist", "artists", "artistname", "channel", "author", "uploader", "singer"]).join(", ");
  const durRaw = pickOne(pairs, ["duration", "duration_ms", "durationms", "durationsec", "length"]);
  const cover = pickOne(pairs, ["cover", "thumbnail", "thumb", "image", "album_art", "albumart", "cover_url", "coverurl", "picture", "img", "artwork"], (v) => /^https?:\/\//i.test(v));
  return {
    audioUrl,
    meta: { title: title || "Spotify Track", artist: artist || "Unknown artist", durationSec: parseDurationSec(durRaw), cover: cover || "" },
  };
}

// Audio sniffing: only real audio bytes pass, so an HTML error page is never sent.
export function audioFormat(buf) {
  if (!buf || buf.length < 5000) return null;
  const head = buf.subarray(0, 12);
  if (head.toString("latin1", 0, 3) === "ID3") return "mp3";
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "mp3";
  if (head.toString("latin1", 0, 4) === "OggS") return "ogg";
  if (head.toString("latin1", 4, 8) === "ftyp") return "m4a";
  if (head.toString("latin1", 0, 4) === "RIFF") return "wav";
  if (head.toString("latin1", 0, 4) === "fLaC") return "flac";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm";
  return null;
}
const EXT = { mp3: ".mp3", ogg: ".ogg", m4a: ".m4a", wav: ".wav", flac: ".flac", webm: ".webm" };

export function installSpotifyCommands(ctx) {
  const { cmd, sendReply, react, CONFIG, dcGet, prexzyGet, ytSearch, __miasMapSet, __miasMapDelete, getSender, isPrivateBlocked, transcodeAudio, voiceBuffer } = ctx;
  const brand = () => `${CONFIG.BOT_NAME || "MIAS"} • SPOTIFY`;

  // Providers, tried in order. Prexzy and Nexray first, then the rest.
  // A provider that is down or returns no audio is skipped.
  const sources = [
    { name: "Prexzy", get: async (url) => { const r = await prexzyGet("/download/spotify", { url }, 40000); return r && r.ok ? r.data : null; } },
    { name: "Nexray", get: async (url) => { const r = await nxGet("/downloader/spotify", { url }, 40000); return r && r.ok ? r.data : null; } },
    { name: "DavidCyril", get: async (url) => { const r = await dcGet("/spotifydl", { url }, 30000); return r && r.ok ? r.data : null; } },
    { name: "DavidCyril 2", get: async (url) => { const r = await dcGet("/download/spotify", { url }, 30000); return r && r.ok ? r.data : null; } },
    { name: "Gifted", get: async (url) => { if (!CONFIG.GIFTED_KEY) return null; return (await axios.get(`${CONFIG.GIFTED_API}/api/download/spotify?apikey=${CONFIG.GIFTED_KEY}&url=${encodeURIComponent(url)}`, { timeout: 30000 })).data; } },
    { name: "Vreden", get: async (url) => (await axios.get(`https://api.vreden.my.id/api/v1/download/spotify?url=${encodeURIComponent(url)}`, { timeout: 30000, headers: UA })).data },
    { name: "Zenzxz", get: async (url) => (await axios.get(`https://api.zenzxz.my.id/downloader/spotify?url=${encodeURIComponent(url)}`, { timeout: 30000, headers: UA })).data },
    { name: "Agatz", get: async (url) => (await axios.get(`https://api.agatz.xyz/api/spotify?url=${encodeURIComponent(url)}`, { timeout: 30000, headers: UA })).data },
    { name: "Siputzx", get: async (url) => (await axios.get(`https://api.siputzx.my.id/api/d/spotify?url=${encodeURIComponent(url)}`, { timeout: 30000, headers: UA })).data },
    { name: "Ryzendesu", get: async (url) => (await axios.get(`https://api.ryzendesu.vip/api/downloader/spotify?url=${encodeURIComponent(url)}`, { timeout: 25000, headers: UA })).data },
  ];

  // Yields each provider that returns audio, in order, within the time budget.
  async function* iterateSources(url, skip = new Set()) {
    const started = Date.now();
    for (const src of sources) {
      if (Date.now() - started > SPOT_FIND_BUDGET_MS) return;
      if (skip.has(src.name)) continue;
      let data = null;
      try { data = await src.get(url); } catch { continue; }
      const parsed = parseSpotifyPayload(data);
      if (parsed) yield { source: src.name, ...parsed };
    }
  }

  // Fill duration and cover from the public Spotify embed page when a provider omits them.
  async function fillFromEmbed(url, meta) {
    const id = (url.match(/track\/([A-Za-z0-9]+)/) || [])[1];
    if (!id) return;
    try {
      const { data } = await axios.get(`https://open.spotify.com/embed/track/${id}`, { timeout: 15000, headers: { ...UA, Accept: "text/html" }, responseType: "text" });
      const html = String(data || "");
      if (!meta.durationSec) { const d = html.match(/"duration(?:_ms|Ms)?"\s*:\s*(\d{4,})/); if (d) meta.durationSec = parseDurationSec(d[1]); }
      if (!meta.cover) { const c = html.match(/property="og:image"\s+content="([^"]+)"/) || html.match(/(https:\/\/(?:i\.scdn\.co|image-cdn-[a-z0-9]+\.spotifycdn\.com)\/image\/[A-Za-z0-9]+)/); if (c) meta.cover = c[1]; }
    } catch {}
  }

  async function resolveCard(url) {
    for await (const c of iterateSources(url)) {
      if (!c.meta.durationSec || !c.meta.cover) await fillFromEmbed(url, c.meta);
      return { url, ...c };
    }
    return null;
  }

  // Name search: first Spotify track link any search provider returns.
  async function findTrackUrl(query) {
    const searchers = [
      async () => { const r = await nxGet("/search/spotify", { q: query }, 20000); return r && r.ok ? r.data : null; },
      async () => { const r = await dcGet("/search/spotify", { text: query }, 18000); return r && r.ok ? r.data : null; },
      async () => (await axios.get(`https://api.siputzx.my.id/api/s/spotify?query=${encodeURIComponent(query)}`, { timeout: 15000, headers: UA })).data,
      async () => { if (!CONFIG.GIFTED_KEY) return null; return (await axios.get(`${CONFIG.GIFTED_API}/api/search/spotify?apikey=${CONFIG.GIFTED_KEY}&q=${encodeURIComponent(query)}`, { timeout: 15000 })).data; },
    ];
    for (const s of searchers) {
      try { const d = await s(); const m = JSON.stringify(d || "").match(SPOTIFY_TRACK_RE); if (m) return m[0]; } catch {}
    }
    return null;
  }

  // Video: a YouTube result whose title matches the track title. Null means "video not available".
  async function findVideoUrl(meta) {
    const want = normTitle(meta.title);
    if (!want) return null;
    try {
      const list = await ytSearch(`${meta.artist} ${meta.title}`);
      for (const v of (Array.isArray(list) ? list : []).slice(0, 5)) {
        if (normTitle(v.title).includes(want) && v.url) return v.url;
      }
    } catch {}
    return null;
  }

  async function fetchBuf(url, timeout = 120000) {
    const r = await axios.get(url, { responseType: "arraybuffer", timeout, maxContentLength: Infinity, maxBodyLength: Infinity, maxRedirects: 5, headers: UA });
    return Buffer.from(r.data || []);
  }
  async function downloadAudio(url) {
    const buf = await fetchBuf(url, 120000);
    const fmt = audioFormat(buf);
    return fmt ? { buf, fmt } : null;
  }
  async function fetchVideoBuf(url) {
    const tries = [
      async () => { const r = await prexzyGet("/download/ytmp4", { url, quality: "720" }, 45000); return r && r.ok ? r.data : null; },
      async () => { const r = await dcGet("/download/ytmp4", { url }, 40000); return r && r.ok ? r.data : null; },
      async () => { if (!CONFIG.GIFTED_KEY) return null; return (await axios.get(`${CONFIG.GIFTED_API}/api/download/ytmp4?apikey=${CONFIG.GIFTED_KEY}&url=${encodeURIComponent(url)}`, { timeout: 60000 })).data; },
    ];
    for (const t of tries) {
      try {
        const d = await t();
        const pairs = walkPairs(d);
        const link = pickOne(pairs, ["download_url", "downloadurl", "download", "url", "dl", "link", "video"], (v) => /^https?:\/\//i.test(v) && !/youtube\.com|youtu\.be/i.test(v));
        if (!link) continue;
        const buf = await fetchBuf(link, 300000);
        if (buf.length > 50000) return buf;
      } catch {}
    }
    return null;
  }

  function buildCard(meta, hasVideo) {
    return [
      `🎧 *${brand()}*`,
      "",
      `🎵 *Title:*     ${String(meta.title).slice(0, 80)}`,
      `👤 *Artist:*    ${String(meta.artist).slice(0, 80)}`,
      `⏱️ *Duration:*  ${fmtDur(meta.durationSec)}`,
      "",
      "━━━━━━━━━━━━━━━━━━━━",
      "📥 *Quote this card with a number:*",
      "",
      "  1️⃣  *Music file* — MP3 audio",
      "  2️⃣  *Voice note* — voice message",
      hasVideo ? "  3️⃣  *Video file* — mp4 ✅" : "  3️⃣  *Video file* — ❌ video not available",
      "",
      "_Example: quote this card with_ `1` _for the music file._",
    ].join("\n");
  }

  // The Spotify card does NOT write the shared .play picker flag. Other picker
  // routers read that flag and would take over bare digits; this module's own
  // listener handles 1/2/3, so .play and every other picker stay untouched.
  function refreshChat() {}
  function sweep() {
    const now = Date.now();
    const jids = [];
    for (const [k, v] of SPOT_PENDING) if (now - v.ts > SPOT_TTL) { SPOT_PENDING.delete(k); jids.push(v.jid); }
    for (const j of jids) refreshChat(j);
  }

  async function getAudioFor(entry) {
    if (entry.audioUrl) { try { const a = await downloadAudio(entry.audioUrl); if (a) return a; } catch {} }
    for await (const c of iterateSources(entry.url, new Set([entry.source]))) {
      try { const a = await downloadAudio(c.audioUrl); if (a) return a; } catch {}
    }
    throw new Error("no provider could deliver this track right now");
  }

  async function deliver(sock, entry, n, m) {
    const jid = m.key.remoteJid;
    const title = entry.meta.title;
    const safe = `${entry.meta.artist} - ${title}`.replace(/[^\w\s.-]/g, "_").trim().slice(0, 70) || "track";
    if (n === 3) {
      if (!entry.videoUrl) { await sendReply(sock, m, `🎬 *Video not available* for *${title}*.`); return; }
      const vbuf = await fetchVideoBuf(entry.videoUrl);
      if (!vbuf) { await sendReply(sock, m, `🎬 *Video not available* right now for *${title}*. Try again later.`); return; }
      await sock.sendMessage(jid, { video: vbuf, mimetype: "video/mp4", caption: `🎵 ${title} — ${entry.meta.artist}` }, { quoted: m });
      return;
    }
    const a = await getAudioFor(entry);
    if (n === 2) {
      const ogg = a.fmt === "ogg" ? a.buf : await voiceBuffer(a.buf, (EXT[a.fmt] || ".mp3").replace(/^\./, ""));
      await sock.sendMessage(jid, { audio: ogg, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: m });
      return;
    }
    // n === 1: music file as MP3 (transcode when the provider sent another format)
    const mp3 = a.fmt === "mp3" ? a.buf : await transcodeAudio(a.buf, (EXT[a.fmt] || ".m4a").replace(/^\./, ""));
    try {
      await sock.sendMessage(jid, { audio: mp3, mimetype: "audio/mpeg", ptt: false, fileName: `${safe}.mp3` }, { quoted: m });
    } catch {
      await sock.sendMessage(jid, { document: mp3, mimetype: "audio/mpeg", fileName: `${safe}.mp3` }, { quoted: m });
    }
  }

  function bindListener(sock) {
    if (!sock || !sock.ev || typeof sock.ev.on !== "function" || SPOT_BOUND.has(sock)) return;
    SPOT_BOUND.add(sock);
    sock.ev.on("messages.upsert", async (up) => {
      try {
        for (const m of (up && up.messages) || []) {
          if (!m || !m.message || !m.key || m.key.remoteJid === "status@broadcast") continue;
          const text = String(m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
          if (!/^[1-3]$/.test(text)) continue;
          sweep();
          const jid = m.key.remoteJid;
          // Match the quoted card first, otherwise the newest pending card in this chat.
          let id = null, entry = null;
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId || "";
          if (quotedId && SPOT_PENDING.has(quotedId) && chatKey(SPOT_PENDING.get(quotedId).jid) === chatKey(jid)) { id = quotedId; entry = SPOT_PENDING.get(quotedId); }
          if (!entry) {
            for (const [k, v] of SPOT_PENDING) if (chatKey(v.jid) === chatKey(jid) && (!entry || v.ts > entry.ts)) { id = k; entry = v; }
          }
          if (!entry) continue;
          const who = String(getSender(m) || "");
          if (entry.user && who && chatKey(entry.user) !== chatKey(who)) continue;
          if (isPrivateBlocked && isPrivateBlocked(m)) continue;
          SPOT_PENDING.delete(id);
          try { await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } }); } catch {}
          try {
            await deliver(sock, entry, Number(text), m);
            try { await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }); } catch {}
          } catch (e) {
            try { await sock.sendMessage(jid, { react: { text: "❌", key: m.key } }); } catch {}
            try { await sendReply(sock, m, `❌ Spotify download failed: ${e?.message || e}`); } catch {}
          }
        }
      } catch {}
    });
  }

  const quotedText = (msg) => {
    try {
      const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      return String(q?.conversation || q?.extendedTextMessage?.text || "").trim();
    } catch { return ""; }
  };
  const usage = () => `🎧 *${brand()}*\n\nUsage: ${CONFIG.PREFIX}spotify <song name or Spotify link>\n\nThen quote the card with *1* (music), *2* (voice note) or *3* (video).`;

  async function spotifyCard(sock, msg, args) {
    const jid = msg.key.remoteJid;
    const query = (args || []).join(" ").trim() || quotedText(msg);
    if (!query) { await sendReply(sock, msg, usage()); return; }
    try { await react(sock, msg, "⏳"); } catch {}
    const status = await sock.sendMessage(jid, { text: `🎧 *${brand()}*\n\n🔍 Searching *${query.slice(0, 80)}* …` }, { quoted: msg }).catch(() => null);
    const clearStatus = async () => { if (status && status.key) { try { await sock.sendMessage(jid, { delete: status.key }); } catch {} } };
    try {
      const link = query.match(SPOTIFY_TRACK_RE);
      const trackUrl = link ? link[0] : await findTrackUrl(query);
      if (!trackUrl) throw new Error("I couldn't find that song on Spotify. Try sending the Spotify link.");
      const track = await resolveCard(trackUrl);
      if (!track) throw new Error("all Spotify providers are busy right now. Try again in a minute.");
      const videoUrl = await findVideoUrl(track.meta);
      const cover = track.meta.cover ? await fetchBuf(track.meta.cover, 15000).catch(() => null) : null;
      const card = buildCard(track.meta, !!videoUrl);
      const sent = cover && cover.length > 2000
        ? await sock.sendMessage(jid, { image: cover, caption: card }, { quoted: msg }).catch(() => null)
        : await sock.sendMessage(jid, { text: card }, { quoted: msg }).catch(() => null);
      await clearStatus();
      if (!sent || !sent.key || !sent.key.id) throw new Error("could not send the music card.");
      sweep();
      SPOT_PENDING.set(sent.key.id, {
        jid, user: String(getSender(msg) || ""), ts: Date.now(),
        url: trackUrl, source: track.source, audioUrl: track.audioUrl,
        meta: track.meta, videoUrl: videoUrl || "",
      });
      const timer = setTimeout(() => { SPOT_PENDING.delete(sent.key.id); }, SPOT_TTL);
      if (timer && typeof timer.unref === "function") timer.unref();
      bindListener(sock);
      try { await react(sock, msg, "✅"); } catch {}
    } catch (e) {
      await clearStatus();
      try { await react(sock, msg, "❌"); } catch {}
      await sendReply(sock, msg, `❌ Spotify failed: ${e?.message || e}`);
    }
  }

  cmd(["spotify", "spot", "spotdl", "spotifydl", "spotify2", "spotifyv2", "spotdlv2"],
    { desc: "Spotify track card: reply 1 music, 2 voice note, 3 video", category: "DOWNLOAD" },
    spotifyCard);

  return { spotifyCard, resolveCard, parseSpotifyPayload, audioFormat };
}
