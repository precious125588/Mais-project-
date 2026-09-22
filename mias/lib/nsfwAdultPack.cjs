// =============================================================================
//  mias/lib/nsfwAdultPack.js
//  ONE installer module — no new "fix pack".
//
//  It runs at the very bottom of mias/index.js and does five jobs:
//    1. Deletes every LEGACY adult/NSFW command from the commands Map.
//    2. Registers the new Prexzy + David Cyril adult commands (via nsfwPrexzy.js).
//    3. Re-registers .play / .play! / .playget / .playdoc with a working,
//       never-silent handler (the old v21 handler threw
//       "no valid audio file url" and the quote path returned silently).
//    4. Re-registers .chatbot / .ai / .duckai so the command always answers.
//    5. Adds an adult branch to .aio by wrapping the ORIGINAL aio handler.
// =============================================================================

'use strict';

const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nsfw = require('./nsfwPrexzy.cjs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Every legacy adult command name that must be removed before we re-register.
const LEGACY_ADULT = [
  'r34', 'r34info', 'r34detail', 'rule34', 'rule34home', 'rule34detail', 'rule34search',
  'hanime', 'hanimesearch', 'hsearch', 'pick',
  'adult', 'adultdl', 'xdl', 'nsfwdl', 'goon', 'goonmode', 'goonoff', 'goonstatus', 'p',
  'xvl', 'xvdl', 'anysitedl', 'pornlink', 'xnxxdl', 'phdl', 'xvddl', 'spankdl', 'rdl',
  'xnxxsearch', 'xvideossearch',
  'ass', 'boobs', 'pussy', 'dick', 'anal', 'cum', 'fuck', 'bdsm', 'futa', 'gay18', 'dp18',
  'feet18', 'group18', 'real18', 'suck18', 'phgif', 'hentaigif',
  'bottomless', 'cumsluts', 'domination', 'extreme18', 'finger18', 'lick18', 'pegged',
  'puffies', 'tattoo18', 'tiny18', 'toys18', 'kiss18', 'sixtynine', 'blacknsfw',
  'easter18', 'xmas18', 'randomnsfw', 'collared18',
];

// In-chat pending store for the play picker — OWNED BY THIS MODULE, so it never
// depends on the bot's quoted-key lookup (which returned null on native flows).
const PLAY_PENDING = new Map(); // jid -> { url, title, ts }

// Captured during install() so reassert() can restore our handlers if one of the
// legacy fix packs re-patches them late (that is what caused the original
// "fix gets overwritten" symptom).
let _SNAPSHOT = null;
let _COMMANDS = null;
const GUARDED = [
  'play', 'music', 'song', 'play2', 'playdoc', 'songdoc', 'play!', 'playptt', 'voiceplay',
  'ai', 'chatbot', 'duckai', 'aio', 'alldl', 'universaldl', 'fb', 'fbdl', 'facebookvideo',
  'xvdl', 'xnxxdl', 'adult', 'adultdl', 'xdl', 'nsfwdl', 'xvideosdl', 'xvideossearch', 'xnxxsearch',
];

function _tmp(ext) {
  const dir = path.join(os.tmpdir(), 'mias-play');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return path.join(dir, `play_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext || 'bin'}`);
}

function _sniff(buf) {
  if (!buf || buf.length < 12) return { kind: 'unknown', ext: 'bin', mime: 'application/octet-stream' };
  const h = buf.subarray(0, 16);
  if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' };
  if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' };
  if (h[0] === 0x4f && h[1] === 0x67 && h[2] === 0x67 && h[3] === 0x53) return { kind: 'audio', ext: 'ogg', mime: 'audio/ogg; codecs=opus' };
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) return { kind: 'audio', ext: 'wav', mime: 'audio/wav' };
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { kind: 'audio', ext: 'webm', mime: 'audio/webm' };
  if (h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) {
    const b = buf.subarray(8, 12).toString('ascii').trim();
    if (b === 'M4A ' || b === 'M4B ') return { kind: 'audio', ext: 'm4a', mime: 'audio/mp4' };
    return { kind: 'video', ext: 'mp4', mime: 'video/mp4' };
  }
  const s = buf.subarray(0, 200).toString('utf8').trim().toLowerCase();
  if (s.startsWith('<!doc') || s.startsWith('<html') || s.startsWith('{')) return { kind: 'bad', ext: 'html', mime: 'text/html' };
  return { kind: 'unknown', ext: 'bin', mime: 'application/octet-stream' };
}

/** Search YouTube without any third-party API — scrape the results page. */
async function searchYt(q) {
  try {
    const { data } = await axios.get('https://www.youtube.com/results', {
      params: { search_query: q }, timeout: 15000,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const m = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(String(data));
    if (!m) return null;
    const t = /"title":\{"runs":\[\{"text":"([^"]{1,120})"/.exec(String(data));
    return { url: `https://www.youtube.com/watch?v=${m[1]}`, title: t ? t[1] : q };
  } catch { return null; }
}

/** Audio provider chain — every provider is a real, documented endpoint. */
async function fetchAudio(url) {
  const errs = [];
  const steps = [
    { via: 'prexzy/ytmp3', fn: async () => (await nsfw.prexzyJson('/download/ytmp3', { url }, 45000)).data },
    { via: 'prexzy/aio',   fn: async () => (await nsfw.prexzyJson('/download/aio',   { url }, 45000)).data },
    { via: 'davidcyril/ytmp3', fn: async () => (await nsfw.dcGet('/download/ytmp3', { url }, 45000)).data },
    { via: 'davidcyril/download', fn: async () => (await nsfw.dcGet('/download', { url }, 45000)).data },
  ];
  for (const s of steps) {
    let media = null;
    try { media = nsfw.pickUrl(await s.fn()); } catch (e) { errs.push(`${s.via}: ${e.message}`); continue; }
    if (!media) { errs.push(`${s.via}: no media url`); continue; }
    try {
      const res = await axios.get(media, {
        responseType: 'arraybuffer', timeout: 120000, maxRedirects: 8,
        headers: { 'User-Agent': UA }, validateStatus: () => true, maxContentLength: 200 * 1024 * 1024,
      });
      const buf = Buffer.from(res.data || []);
      if (buf.length < 5000) { errs.push(`${s.via}: too small`); continue; }
      const sn = _sniff(buf);
      if (sn.kind === 'bad') { errs.push(`${s.via}: provider returned a web page instead of media`); continue; }
      if (sn.kind !== 'audio') { errs.push(`${s.via}: not audio (${sn.kind})`); continue; }
      return { ok: true, buf, ...sn, via: s.via };
    } catch (e) { errs.push(`${s.via}: ${e.message}`); }
  }
  return { ok: false, errs };
}

function install(deps) {
  const { commands, cmd, sendReply, react, getSettings, getOwnerJid, CONFIG, MENU_CATEGORIES } = deps || {};
  if (!commands || typeof cmd !== 'function') throw new Error('nsfwAdultPack: commands/cmd missing');
  const P = (CONFIG && CONFIG.PREFIX) || '.';
  const log = [];

  // ── 1. purge legacy adult commands ─────────────────────────────────────────
  let removed = 0;
  for (const n of LEGACY_ADULT) {
    if (commands.has(n)) { commands.delete(n); removed++; }
  }
  // also purge anything the old NSFW map loops registered
  for (const [k, v] of [...commands.entries()]) {
    const c = String(v?.category || '').toUpperCase();
    if (c === 'NSFW' || c === 'ADULT') { commands.delete(k); removed++; }
  }
  log.push(`removed ${removed} legacy adult commands`);
  _COMMANDS = commands;

  const _reply = (sock, msg, t) => (typeof sendReply === 'function'
    ? sendReply(sock, msg, t)
    : sock.sendMessage(msg.key.remoteJid, { text: t }, { quoted: msg }));
  const _react = (sock, msg, e) => { try { if (typeof react === 'function') react(sock, msg, e); } catch {} };

  // ── 2. new adult command pack ──────────────────────────────────────────────
  const packInfo = nsfw.install({
    cmd, sendReply, react, getSettings, getOwnerJid, CONFIG,
    _dispatch: (name) => commands.get(name),
  });
  log.push(`registered ${packInfo.commands} adult commands`);

  // ── 3. PLAY — never silent, real provider chain ────────────────────────────
  async function doPlay(sock, msg, query, mode) {
    const jid = msg.key.remoteJid;
    const wait = await sock.sendMessage(jid, { text: `🎵 *Player*\n\n🔍 Resolving *"${query}"*...` }, { quoted: msg });
    const edit = (t) => sock.sendMessage(jid, { text: t, edit: wait.key }).catch(() => {});
    let url = /^https?:\/\//i.test(query) ? query : null;
    let title = query;
    if (!url) {
      const s = await searchYt(query);
      if (s) { url = s.url; title = s.title || query; }
    }
    if (!url) { await edit(`❌ *Not found*\n\nNo result for *${query}*.\nTry a YouTube link instead.`); return; }
    await edit(`🎵 *Player*\n\n✅ Found: *${title}*\n⬡ Downloading audio...`);
    const a = await fetchAudio(url);
    if (!a.ok) {
      await edit(`❌ *Download failed*\n\nAll providers tried:\n${a.errs.slice(0, 5).map(x => `• ${x}`).join('\n')}\n\n_Try *${P}play2 ${query}* or paste a direct link._`);
      return;
    }
    const safe = String(title).replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 60) || 'audio';
    try {
      if (mode === 'doc') {
        await sock.sendMessage(jid, { document: a.buf, mimetype: a.mime, fileName: `${safe}.${a.ext}`, caption: `📄 *${title}*` }, { quoted: msg });
      } else if (mode === 'ptt') {
        await sock.sendMessage(jid, { audio: a.buf, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { audio: a.buf, mimetype: a.mime, ptt: false, fileName: `${safe}.${a.ext}` }, { quoted: msg });
      }
      try { await sock.sendMessage(jid, { delete: wait.key }); } catch {}
    } catch (e) {
      try {
        await sock.sendMessage(jid, { document: a.buf, mimetype: a.mime, fileName: `${safe}.${a.ext}`, caption: `📄 *${title}* (sent as document)` }, { quoted: msg });
      } catch (e2) { await edit(`❌ WhatsApp rejected the audio: ${e2.message}`); }
    }
  }

  cmd(['play', 'music', 'song'], { desc: `Play song — ${P}play <name or URL>`, category: 'DOWNLOAD' }, async (sock, msg, args) => {
    let q = (args || []).join(' ').trim();
    if (!q) {
      try {
        const c = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        q = (c?.conversation || c?.extendedTextMessage?.text || '').trim();
      } catch {}
    }
    if (!q) { await _reply(sock, msg, `🎵 *Usage:* ${P}play <song name or YouTube URL>\n\n_Reply to a message containing a link and send *${P}play*._`); return; }
    await _react(sock, msg, '🎵');
    await doPlay(sock, msg, q, 'audio');
  });

  cmd(['play2'], { desc: `Play song (high quality) — ${P}play2 <name>`, category: 'DOWNLOAD' }, async (sock, msg, args) => {
    const q = (args || []).join(' ').trim();
    if (!q) { await _reply(sock, msg, `🎵 *Usage:* ${P}play2 <song name or URL>`); return; }
    await _react(sock, msg, '🎵');
    await doPlay(sock, msg, q, 'audio');
  });

  cmd(['playdoc', 'songdoc', 'play!'], { desc: `Play song as document — ${P}playdoc <name>`, category: 'DOWNLOAD' }, async (sock, msg, args) => {
    const q = (args || []).join(' ').trim();
    if (!q) { await _reply(sock, msg, `📄 *Usage:* ${P}playdoc <song name or URL>`); return; }
    await _react(sock, msg, '📄');
    await doPlay(sock, msg, q, 'doc');
  });

  cmd(['playptt', 'voiceplay'], { desc: `Play song as voice note — ${P}playptt <name>`, category: 'DOWNLOAD' }, async (sock, msg, args) => {
    const q = (args || []).join(' ').trim();
    if (!q) { await _reply(sock, msg, `🎤 *Usage:* ${P}playptt <song name or URL>`); return; }
    await _react(sock, msg, '🎤');
    await doPlay(sock, msg, q, 'ptt');
  });

  // ── 4. CHATBOT — always answers ────────────────────────────────────────────
  cmd(['ai', 'chatbot', 'duckai'], { desc: 'Chat with AI', category: 'AI' }, async (sock, msg, args) => {
    const q = (args || []).join(' ').trim();
    if (!q) { await _reply(sock, msg, `💬 *Usage:* ${P}ai <question>`); return; }
    await _react(sock, msg, '💬');
    const jid = msg.key.remoteJid;
    const wait = await sock.sendMessage(jid, { text: `💬 *AI*\n\n⬡ Thinking...` }, { quoted: msg });
    const edit = (t) => sock.sendMessage(jid, { text: t, edit: wait.key }).catch(() => {});
    let out = null;
    try { const r = await nsfw.prexzyJson('/ai/chatbot', { text: q }, 25000); if (r.ok) { const d = r.data?.data || r.data; out = d?.text || d?.message || d?.result || d?.response || d?.answer || null; } } catch {}
    if (!out) { try { const r = await nsfw.dcGet('/ai/deepseek-v3', { text: q }, 25000); if (r.ok) out = r.data?.result || null; } catch {} }
    if (!out) { await edit(`❌ *AI unavailable*\n\nNo provider answered. Try again shortly.`); return; }
    await edit(`💬 *AI*\n\n${String(out).slice(0, 3500)}`);
  });

  // ── shared Facebook download chain (used by .aio and .fb) ─────────────────
  async function _fbDownload(sock, msg, url, viaLabel) {
    const jid = msg.key.remoteJid;
    const wait = await sock.sendMessage(jid, { text: `📘 *${viaLabel}*\n\n⬡ Fetching Facebook media...` }, { quoted: msg });
    const edit = (t) => sock.sendMessage(jid, { text: t, edit: wait.key }).catch(() => {});
    const chain = [
      { via: 'prexzy/facebook',   fn: async () => { const r = await nsfw.prexzyJson('/download/facebook',  { url }, 40000); if (!r.ok) throw new Error(r.error); return nsfw.pickUrl(r.data); } },
      { via: 'prexzy/facebookv2', fn: async () => { const r = await nsfw.prexzyJson('/download/facebookv2', { url }, 40000); if (!r.ok) throw new Error(r.error); return nsfw.pickUrl(r.data); } },
      { via: 'davidcyril/facebook', fn: async () => { const r = await nsfw.dcGet('/download/facebook', { url }, 40000); if (!r.ok) throw new Error(r.error); return nsfw.pickUrl(r.data); } },
      { via: 'gifted/facebook',   fn: async () => { const r = await nsfw.giftedFb(url); if (!r.ok) throw new Error(r.error); return r.url; } },
      { via: 'nexray/aio',        fn: async () => { const r = await nsfw.nexrayAio(url); if (!r.ok) throw new Error(r.error); return r.url; } },
    ];
    const errs = [];
    for (const step of chain) {
      let media = null;
      try { media = await step.fn(); } catch (e) { errs.push(`${step.via}: ${e.message}`); continue; }
      if (!media) { errs.push(`${step.via}: no media url`); continue; }
      try {
        const f = await nsfw.streamToFile(media, { Referer: 'https://www.facebook.com/' });
        const data = fs.readFileSync(f.tmp);
        const cap = `📘 *Facebook Video*\n_Via ${step.via}_`;
        try {
          await sock.sendMessage(jid, { video: data, mimetype: f.mime || 'video/mp4', fileName: `facebook.${f.ext}`, caption: cap }, { quoted: msg });
        } catch {
          await sock.sendMessage(jid, { document: data, mimetype: f.mime || 'video/mp4', fileName: `facebook.${f.ext}`, caption: cap + ' (document)' }, { quoted: msg });
        }
        nsfw.cleanTmp(f);
        try { await sock.sendMessage(jid, { delete: wait.key }); } catch {}
        return true;
      } catch (e) { errs.push(`${step.via}: ${e.message}`); }
    }
    await edit(`❌ *Facebook download failed*\n\n${errs.slice(0, 5).map(x => `• ${x}`).join('\n')}\n\n_Try *${P}fb <url>* or again shortly._`);
    return false;
  }

  // ── 5. AIO — adult branch, then fall through to the original handler ───────
  const origAio = commands.get('aio')?.handler || null;
  cmd(['aio', 'alldl', 'universaldl'], { desc: 'Universal downloader (+ adult routing)', category: 'DOWNLOAD' }, async (sock, msg, args) => {
    let url = (args || [])[0] || '';
    if (!/^https?:/i.test(url)) {
      try {
        const c = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const t = c?.conversation || c?.extendedTextMessage?.text || c?.videoMessage?.caption || '';
        const m = /https?:\/\/\S+/.exec(t || ''); if (m) url = m[0];
      } catch {}
    }
    if (url && /xvideos\.|xnxx\./i.test(url)) {
      const jid = msg.key.remoteJid;
      await _react(sock, msg, '🔞');
      const wait = await sock.sendMessage(jid, { text: `🔞 *AIO → Adult pipeline*\n\n⬡ Resolving...\n_URL:_ ${url.slice(0, 90)}` }, { quoted: msg });
      const eps = /xnxx\./i.test(url) ? ['/nsfw/xnxx-dl', '/nsfw/xvideos-dl', '/download/aio'] : ['/nsfw/xvideos-dl', '/nsfw/xnxx-dl', '/download/aio'];
      const errs = [];
      for (const ep of eps) {
        let media = null;
        try { const r = await nsfw.prexzyJson(ep, { url }, 45000); if (r.ok) media = nsfw.pickUrl(r.data); else errs.push(`${ep}: ${r.error}`); } catch (e) { errs.push(`${ep}: ${e.message}`); }
        if (!media) { if (!errs.length) errs.push(`${ep}: no media`); continue; }
        try {
          const f = await nsfw.streamToFile(media, { Referer: 'https://www.google.com/' });
          await sock.sendMessage(jid, { video: fs.readFileSync(f.tmp), mimetype: f.mime || 'video/mp4', fileName: `adult.${f.ext}`, caption: `🔞 *Adult Video*\n_Via ${ep}_` }, { quoted: msg });
          nsfw.cleanTmp ? nsfw.cleanTmp(f) : fs.unlinkSync(f.tmp);
          try { await sock.sendMessage(jid, { delete: wait.key }); } catch {}
          return;
        } catch (e) { errs.push(`${ep}: ${e.message}`); }
      }
      await sock.sendMessage(jid, { text: `❌ *AIO adult download failed*\n\n${errs.slice(0, 5).map(x => `• ${x}`).join('\n')}\n\n_Try *${P}xvdl <url>* or *${P}xnxxdl <url>*._`, edit: wait.key }, { quoted: msg });
      return;
    }
    if (url && /facebook\.com|fb\.watch|fb\.com/i.test(url)) {
      await _react(sock, msg, '📘');
      await _fbDownload(sock, msg, url, 'AIO → Facebook');
      return;
    }
    if (typeof origAio === 'function') return origAio(sock, msg, args);
    await _reply(sock, msg, `Usage: *${P}aio <social_url>*`);
  });

  // ── Facebook dedicated command ────────────────────────────────────────────
  cmd(['fb', 'fbdl', 'facebookvideo'], { desc: `Facebook video — ${P}fb <url>`, category: 'DOWNLOAD' }, async (sock, msg, args) => {
    let url = (args || [])[0] || '';
    if (!/^https?:/i.test(url)) {
      try {
        const c = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const t = c?.conversation || c?.extendedTextMessage?.text || c?.videoMessage?.caption || '';
        const m = /https?:\/\/\S+/.exec(t || ''); if (m) url = m[0];
      } catch {}
    }
    if (!/^https?:/i.test(url)) { await _reply(sock, msg, `Usage: *${P}fb <facebook video url>*`); return; }
    await _react(sock, msg, '📘');
    await _fbDownload(sock, msg, url, 'Facebook Downloader');
  });

  // ── 6. make sure the NSFW category shows in .menu ──────────────────────────
  if (Array.isArray(MENU_CATEGORIES)) {
    const idx = MENU_CATEGORIES.findIndex(c => String(c.name || '').toUpperCase() === 'NSFW');
    const entry = {
      name: 'NSFW', emoji: '🔞', adult: true,
      cmds: [...Object.keys(nsfw.RANDOM_CATS), ...Object.keys(nsfw.SEARCH_EPS),
             ...Object.keys(nsfw.DL_EPS), ...Object.keys(nsfw.IMG_GEN)],
    };
    if (idx >= 0) MENU_CATEGORIES[idx] = entry; else MENU_CATEGORIES.push(entry);
    log.push('NSFW category synced to menu');
  }

  // ── 7. re-assert our handlers after the legacy fix packs have run ──────────
  _SNAPSHOT = new Map();
  for (const n of GUARDED) { const e = commands.get(n); if (e) _SNAPSHOT.set(n, e); }
  setTimeout(() => reassert(), 9000);
  setTimeout(() => reassert(), 30000);
  log.push(`guarding ${_SNAPSHOT.size} handlers`);

  return { removed, log, commands: packInfo.commands };
}

/**
 * Re-apply the adult pack's handlers. Safe to call at any time; returns the
 * number of handlers restored (0 if install() never ran).
 */
function reassert() {
  try {
    if (!_SNAPSHOT || !_COMMANDS) return 0;
    for (const n of LEGACY_ADULT) _COMMANDS.delete(n);
    for (const [n, e] of _SNAPSHOT) _COMMANDS.set(n, e);
    return _SNAPSHOT.size;
  } catch { return 0; }
}

function boot(deps) {
  try {
    const r = install(deps);
    console.log(`[nsfw-pack] ✅ ${r.log.join(' | ')}`);
    return r;
  } catch (e) {
    console.log('[nsfw-pack] ❌ install failed:', (e && e.message) || e);
    return null;
  }
}

module.exports = { install, boot, reassert, LEGACY_ADULT, GUARDED, PLAY_PENDING, searchYt, fetchAudio, _sniff };
