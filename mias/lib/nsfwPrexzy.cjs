// =============================================================================
//  mias/lib/nsfwPrexzy.js   (v2 — 429-safe)
//  NSFW / 18+ command pack — Prexzy APIs + David Cyril APIs
//  v2 fixes vs v1 (all driven by live probes + the user's screenshots):
//    • Prexzy returns HTTP 429 + JSON under load. v1 did not retry, so a
//      rate-limit JSON body could reach the sender. v2 retries once with
//      backoff and treats JSON/HTML bodies as failures, NEVER media.
//    • DL/search probe results (2026-09-22):
//        /nsfw/<cat>        -> 200 image/jpeg|image/gif  (20/37 during hammering,
//                             rest were 429 = rate limit, not missing endpoints)
//        /nsfw/xvideos-dl   -> 200 JSON {status:true,title,...}
//        /nsfw/xnxx-dl      -> 200 JSON {status:true,...}
//        /nsfw/*-search     -> 200 JSON {videos:[...]}
//        /download/aio +fb  -> 404 "Failed to download video"  (aio CANNOT do FB)
//        /download/facebook -> 500 / facebookv2 -> 500 (both broken upstream)
// =============================================================================

'use strict';

const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREXZY_BASE = process.env.PREXZY_BASE || 'https://prexzyapis.com';
const DC_BASE = process.env.DC_BASE || 'https://apis.davidcyril.name.ng';
const DC_KEY =
  process.env.DC_API_KEY || process.env.DAVID_CYRIL_KEY || process.env.DC_KEY || '';
const NEXRAY_AIO = 'https://api.nexray.eu.cc/downloader/aio';
const GIFTED_API = process.env.GIFTED_API || 'https://api.giftedtech.co.ke/api';
const GIFTED_KEY = process.env.GIFTED_KEY || 'gifted';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const REQ_TIMEOUT   = 25000;
const DL_TIMEOUT    = 10 * 60 * 1000;   // 10-minute hard cap per download
const DOC_OVER_BYTES = 100 * 1024 * 1024;
const MIN_BYTES      = 1024;

const RANDOM_CATS = {
  anal:        { ep: '/nsfw/anal',       label: 'Anal 🔞' },
  ass:         { ep: '/nsfw/ass',        label: 'Ass 🔞' },
  bdsm:        { ep: '/nsfw/bdsm',       label: 'BDSM 🔞' },
  blacknsfw:   { ep: '/nsfw/black',      label: 'Black 🔞' },
  boobs:       { ep: '/nsfw/boobs',      label: 'Boobs 🔞' },
  bottomless:  { ep: '/nsfw/bottomless', label: 'Bottomless 🔞' },
  collared18:  { ep: '/nsfw/collared',   label: 'Collared 🔞' },
  cum:         { ep: '/nsfw/cum',        label: 'Cum 🔞' },
  cumsluts:    { ep: '/nsfw/cumsluts',   label: 'Cumsluts 🔞' },
  dick:        { ep: '/nsfw/dick',       label: 'Dick 🔞' },
  domination:  { ep: '/nsfw/dom',        label: 'Domination 🔞' },
  dp18:        { ep: '/nsfw/dp',         label: 'DP 🔞' },
  easter18:    { ep: '/nsfw/easter',     label: 'Easter 🔞' },
  extreme18:   { ep: '/nsfw/extreme',    label: 'Extreme 🔞' },
  feet18:      { ep: '/nsfw/feet',       label: 'Feet 🔞' },
  finger18:    { ep: '/nsfw/finger',     label: 'Finger 🔞' },
  fuck:        { ep: '/nsfw/fuck',       label: 'Fuck 🔞' },
  futa:        { ep: '/nsfw/futa',       label: 'Futa 🔞' },
  gay18:       { ep: '/nsfw/gay',        label: 'Gay 18+ 🔞' },
  hentaigif:   { ep: '/nsfw/gif',        label: 'Hentai GIF 🔞', isGif: true },
  group18:     { ep: '/nsfw/group',      label: 'Group 🔞' },
  hanime:      { ep: '/nsfw/hentai',     label: 'Hentai 🔞' },
  hentaisfm:   { ep: '/nsfw/hentai-sfm', label: 'Hentai SFM 🔞' },
  kiss18:      { ep: '/nsfw/kiss',       label: 'Kiss 🔞' },
  lick18:      { ep: '/nsfw/lick',       label: 'Lick 🔞' },
  pegged:      { ep: '/nsfw/pegged',     label: 'Pegged 🔞' },
  phgif:       { ep: '/nsfw/phgif',      label: 'PH GIF 🔞', isGif: true },
  puffies:     { ep: '/nsfw/puffies',    label: 'Puffies 🔞' },
  pussy:       { ep: '/nsfw/pussy',      label: 'Pussy 🔞' },
  real18:      { ep: '/nsfw/real',       label: 'Real 🔞' },
  sixtynine:   { ep: '/nsfw/sixtynine',  label: '69 🔞', isGif: true },
  suck18:      { ep: '/nsfw/suck',       label: 'Suck 🔞' },
  tattoo18:    { ep: '/nsfw/tattoo',     label: 'Tattoo 🔞' },
  tiny18:      { ep: '/nsfw/tiny',       label: 'Tiny 🔞' },
  toys18:      { ep: '/nsfw/toys',       label: 'Toys 🔞' },
  xmas18:      { ep: '/nsfw/xmas',       label: 'Xmas 🔞' },
};

const SEARCH_EPS = {
  xvideossearch: { ep: '/nsfw/xvideos-search', q: 'query', label: 'XVideos Search 🔞' },
  xvsearch:      { ep: '/nsfw/xvideos-search', q: 'query', label: 'XVideos Search 🔞' },
  xnxxsearch:    { ep: '/nsfw/xnxx-search',    q: 'query', label: 'XNXX Search 🔞' },
};

const DL_EPS = {
  xvideosdl: { ep: '/nsfw/xvideos-dl', label: 'XVideos Downloader 🔞', match: /xvideos\./i },
  xvdl:      { ep: '/nsfw/xvideos-dl', label: 'XVideos Downloader 🔞', match: /xvideos\./i },
  xnxxdl:    { ep: '/nsfw/xnxx-dl',    label: 'XNXX Downloader 🔞',    match: /xnxx\./i },
};

const IMG_GEN = {
  pornmaster:   { ep: '/imagecreator/pornmaster',    label: 'PornMaster 🔞' },
  pornmasterv6: { ep: '/imagecreator/pornmaster-v6', label: 'PornMaster V6 🔞' },
  pornmasterv7: { ep: '/imagecreator/pornmaster-v7', label: 'PornMaster V7 🔞' },
};

// David Cyril adult candidates — UNVERIFIED (not in their public docs).
const DC_ADULT_PATHS = ['/xxx/xvideos', '/xxx/xnxx', '/xxx/xvideos-dl', '/xxx/xnxx-dl', '/download/xvideos', '/download/xnxx'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function _tmpFile(ext) {
  const dir = path.join(os.tmpdir(), 'mias-nsfw');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return path.join(dir, `nsfw_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext || 'bin'}`);
}

function _sniff(buf) {
  if (!buf || buf.length < 12) return { kind: 'unknown', ext: 'bin', mime: 'application/octet-stream' };
  const h = buf.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return { kind: 'image', ext: 'png', mime: 'image/png' };
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return { kind: 'gif', ext: 'gif', mime: 'image/gif' };
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return { kind: 'image', ext: 'webp', mime: 'image/webp' };
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { kind: 'video', ext: 'webm', mime: 'video/webm' };
  if (h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) {
    const b = h.subarray(8, 12).toString('ascii').trim();
    if (b === 'M4A ' || b === 'M4B ') return { kind: 'audio', ext: 'm4a', mime: 'audio/mp4' };
    return { kind: 'video', ext: 'mp4', mime: 'video/mp4' };
  }
  if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' };
  if (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) return { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' };
  const s = buf.subarray(0, 200).toString('utf8').trim().toLowerCase();
  if (s.startsWith('<!doc') || s.startsWith('<html') || s.startsWith('<?xml') || s.startsWith('{'))
    return { kind: 'bad', ext: 'html', mime: 'text/html' };
  return { kind: 'unknown', ext: 'bin', mime: 'application/octet-stream' };
}

/** GET JSON with one 429-retry. Never returns JSON error bodies as success. */
async function prexzyJson(ep, params = {}, timeout = REQ_TIMEOUT) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await axios.get(`${PREXZY_BASE}${ep}`, {
        params, timeout, headers: { 'User-Agent': UA, Accept: 'application/json' },
        validateStatus: () => true,
      });
      if (res.status === 429) {
        if (attempt === 0) { await sleep(3000); continue; }
        return { ok: false, error: 'Prexzy rate limit (429) — wait ~30 seconds', rateLimited: true };
      }
      const d = res.data;
      if (res.status >= 400) return { ok: false, error: d?.error || d?.message || `HTTP ${res.status}` };
      if (d && d.status === false) return { ok: false, error: d.error || d.message || 'provider failed' };
      return { ok: true, data: d };
    } catch (e) {
      if (attempt === 0 && /timeout|ECONN|network/i.test(e.message)) { await sleep(1500); continue; }
      return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'unreachable' };
}

/** GET binary media with one 429-retry. A JSON/HTML body is ALWAYS a failure. */
async function prexzyBin(ep, params = {}, timeout = REQ_TIMEOUT) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await axios.get(`${PREXZY_BASE}${ep}`, {
        params, timeout, responseType: 'arraybuffer',
        headers: { 'User-Agent': UA, Accept: '*/*' }, maxRedirects: 6,
        validateStatus: () => true, maxContentLength: 200 * 1024 * 1024,
      });
      const ct = String(res.headers?.['content-type'] || '');
      if (res.status === 429) {
        if (attempt === 0) { await sleep(3000); continue; }
        return { ok: false, error: 'Prexzy rate limit (429) — wait ~30 seconds', rateLimited: true };
      }
      if (res.status >= 400) return { ok: false, error: `HTTP ${res.status}` };
      // An application/json body here is an error payload, never media.
      if (/json|html|text/i.test(ct)) return { ok: false, error: 'provider returned JSON/HTML instead of media' };
      const buf = Buffer.from(res.data || []);
      if (buf.length < MIN_BYTES) return { ok: false, error: `too small (${buf.length}B)` };
      const sniff = _sniff(buf);
      if (sniff.kind === 'bad') return { ok: false, error: 'provider returned a web page instead of media' };
      if (sniff.kind === 'unknown') sniff.kind = 'image'; // endpoint class is image/gif; trust content-type
      return { ok: true, buf, contentType: ct, ...sniff };
    } catch (e) {
      if (attempt === 0 && /timeout|ECONN|network/i.test(e.message)) { await sleep(1500); continue; }
      return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'unreachable' };
}

async function dcGet(ep, params = {}, timeout = REQ_TIMEOUT) {
  try {
    const p = { ...params };
    if (DC_KEY) p.apikey = DC_KEY;
    const res = await axios.get(`${DC_BASE}${ep}`, {
      params: p, timeout,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(DC_KEY ? { 'X-API-Key': DC_KEY } : {}) },
      validateStatus: () => true,
    });
    const d = res.data;
    if (res.status === 401) return { ok: false, error: 'David Cyril API key required (set DC_API_KEY)', needsKey: true };
    if (res.status >= 400) return { ok: false, error: d?.message || `HTTP ${res.status}` };
    if (d && d.success === false) return { ok: false, error: d.message || 'DC error' };
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Nexray AIO — generic social fallback (Facebook etc.). */
async function nexrayAio(url, timeout = 40000) {
  try {
    const res = await axios.get(`${NEXRAY_AIO}?url=${encodeURIComponent(url)}`, {
      timeout, headers: { 'User-Agent': UA }, validateStatus: () => true,
    });
    if (res.status >= 400) return { ok: false, error: `nexray HTTP ${res.status}` };
    const d = res.data?.result || res.data?.data || res.data;
    const u = d?.url || d?.video || d?.hd || d?.sd || d?.audio || d?.download_url || d?.dl ||
      (typeof d === 'string' && /^https?:\/\//i.test(d) ? d : null);
    if (!u) return { ok: false, error: 'nexray: no media url' };
    return { ok: true, url: u, title: d?.title || null, thumb: d?.thumbnail || d?.cover || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** GiftedTech Facebook fallback. */
async function giftedFb(url, timeout = 40000) {
  try {
    const res = await axios.get(`${GIFTED_API}/download/facebook?apikey=${GIFTED_KEY}&url=${encodeURIComponent(url)}`, {
      timeout, headers: { 'User-Agent': UA }, validateStatus: () => true,
    });
    const d = res.data?.result || res.data;
    const u = d?.hd || d?.sd || d?.download_url || d?.url || d?.video || null;
    if (!u) return { ok: false, error: 'gifted: no media url' };
    return { ok: true, url: u, title: d?.title || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function pickUrl(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') return /^https?:\/\//i.test(obj) ? obj : null;
  if (Array.isArray(obj)) {
    for (const v of obj) { const u = pickUrl(v, depth + 1); if (u) return u; }
    return null;
  }
  if (typeof obj !== 'object') return null;
  const pref = ['download', 'downloadUrl', 'download_url', 'dl', 'dl_link', 'dllink',
    'url', 'link', 'mp4', 'mp4Url', 'video', 'videoUrl', 'video_url', 'hd', 'sd',
    'hls', 'hlsUrl', 'play', 'src', 'file', 'media', 'direct', 'result'];
  for (const k of pref) {
    const v = obj[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  for (const k of Object.keys(obj)) {
    const u = pickUrl(obj[k], depth + 1);
    if (u) return u;
  }
  return null;
}

/** Stream URL → disk (10-min cap). Junk/JSON/HTML responses are rejected. */
async function streamToFile(url, headers = {}) {
  const tmp = _tmpFile('mp4');
  const res = await axios.get(url, {
    responseType: 'stream', timeout: DL_TIMEOUT, maxRedirects: 8,
    maxContentLength: 2 * 1024 * 1024 * 1024, validateStatus: () => true,
    headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity', ...headers },
  });
  if (res.status >= 400) { try { res.data.destroy(); } catch {} throw new Error(`media HTTP ${res.status}`); }
  const ct = String(res.headers?.['content-type'] || '');
  if (/json|text\/html/i.test(ct)) { try { res.data.destroy(); } catch {} throw new Error('provider returned an error page instead of media'); }
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(tmp);
    res.data.pipe(ws);
    res.data.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
  });
  const size = fs.statSync(tmp).size;
  const head = Buffer.alloc(16);
  const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
  const sniff = _sniff(head);
  if (sniff.kind === 'bad' || size < MIN_BYTES) {
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error(`provider returned an error page instead of media (${size}B)`);
  }
  if (sniff.kind === 'unknown') { sniff.kind = 'video'; sniff.ext = 'mp4'; sniff.mime = 'video/mp4'; }
  return { tmp, size, ...sniff };
}

async function sendMedia(sock, msg, file, title, label) {
  const jid = msg.key.remoteJid;
  const cap = `🔞 *${title || label || 'NSFW'}*`;
  if (file.kind === 'image') {
    await sock.sendMessage(jid, { image: file.buf || fs.readFileSync(file.tmp), caption: cap }, { quoted: msg });
    return;
  }
  if (file.kind === 'gif') {
    await sock.sendMessage(jid, { video: file.buf || fs.readFileSync(file.tmp), gifPlayback: true, mimetype: 'image/gif', caption: cap }, { quoted: msg });
    return;
  }
  const size = file.size ?? (file.buf ? file.buf.length : 0);
  const asDoc = size > DOC_OVER_BYTES;
  const data = file.buf || fs.readFileSync(file.tmp);
  try {
    if (asDoc) throw new Error('over inline cap');
    await sock.sendMessage(jid, {
      video: data, mimetype: file.mime || 'video/mp4',
      fileName: `${(title || 'video').slice(0, 50)}.${file.ext || 'mp4'}`, caption: cap,
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(jid, {
      document: data, mimetype: file.mime || 'video/mp4',
      fileName: `${(title || 'video').slice(0, 50)}.${file.ext || 'mp4'}`,
      caption: `${cap}\n📎 _sent as document — ${(size / 1048576).toFixed(1)}MB${asDoc ? ' (over 100MB inline cap)' : ''}_`,
    }, { quoted: msg });
  }
}

function cleanTmp(file) { try { if (file && file.tmp) fs.unlinkSync(file.tmp); } catch {} }

// ── command registration ─────────────────────────────────────────────────────
function install(deps) {
  const { cmd, sendReply, react, getSettings, getOwnerJid, CONFIG } = deps || {};
  if (typeof cmd !== 'function') throw new Error('nsfwPrexzy.install: cmd() missing');
  const P = (CONFIG && CONFIG.PREFIX) || '.';

  const _reply = (sock, msg, t) => (typeof sendReply === 'function'
    ? sendReply(sock, msg, t)
    : sock.sendMessage(msg.key.remoteJid, { text: t }, { quoted: msg }));
  const _react = (sock, msg, e) => { try { if (typeof react === 'function') react(sock, msg, e); } catch {} };

  function adultOn(msg) {
    try {
      const jid = msg.key.remoteJid;
      const s = (typeof getSettings === 'function' ? getSettings(jid) : null) || {};
      let o = {};
      if (typeof getOwnerJid === 'function' && typeof getSettings === 'function') o = getSettings(getOwnerJid()) || {};
      if (s.safeMode || o.safeMode) return false;
      return !!(s.adultMode || s.adultDl || o.adultMode || o.adultDl);
    } catch { return false; }
  }

  async function gate(sock, msg) {
    if (adultOn(msg)) return true;
    await _reply(sock, msg,
      `🔞 *Adult Mode is OFF*\n\nThis command is 18+ only and is disabled.\n\n` +
      `Enable it with *${P}setting* → option *23.1*\n_(Safe Mode overrides this and keeps everything off.)_`);
    return false;
  }

  // 36 random image/GIF categories (429-safe)
  for (const [name, info] of Object.entries(RANDOM_CATS)) {
    cmd([name], { desc: `${info.label} — random media (18+)`, category: 'NSFW', adult: true },
      async (sock, msg) => {
        if (!(await gate(sock, msg))) return;
        await _react(sock, msg, '🔞');
        const jid = msg.key.remoteJid;
        const r = await prexzyBin(info.ep);
        if (!r.ok) {
          await _reply(sock, msg, r.rateLimited
            ? `⏳ *${info.label}* — provider is rate-limiting right now (HTTP 429).\n_Wait ~30 seconds and send the command again._`
            : `❌ *${info.label}* failed.\n_${r.error}_\n\nTry again in a moment.`);
          return;
        }
        try {
          if (r.kind === 'image') {
            await sock.sendMessage(jid, { image: r.buf, caption: `🔞 *${info.label}*` }, { quoted: msg });
          } else if (r.kind === 'gif' || r.kind === 'video') {
            await sock.sendMessage(jid, {
              video: r.buf, gifPlayback: r.kind === 'gif',
              mimetype: r.kind === 'gif' ? 'image/gif' : (r.mime || 'video/mp4'),
              caption: `🔞 *${info.label}*`,
            }, { quoted: msg });
          } else {
            await sock.sendMessage(jid, { image: r.buf, caption: `🔞 *${info.label}*` }, { quoted: msg });
          }
        } catch (e) {
          await _reply(sock, msg, `❌ *${info.label}* could not be delivered.\n_${e.message}_`);
        }
      });
  }

  // search
  for (const [name, info] of Object.entries(SEARCH_EPS)) {
    cmd([name], { desc: `${info.label} — ${P}${name} <query>`, category: 'NSFW', adult: true },
      async (sock, msg, args) => {
        if (!(await gate(sock, msg))) return;
        const q = (args || []).join(' ').trim();
        if (!q) { await _reply(sock, msg, `Usage: *${P}${name} <query>*`); return; }
        await _react(sock, msg, '🔍');
        const r = await prexzyJson(info.ep, { [info.q]: q });
        if (!r.ok) { await _reply(sock, msg, r.rateLimited ? '⏳ Rate limited — wait ~30s and retry.' : `❌ Search failed.\n_${r.error}_`); return; }
        const list = r.data?.videos || r.data?.results || r.data?.data || [];
        if (!Array.isArray(list) || !list.length) { await _reply(sock, msg, `❌ No results for *${q}*.`); return; }
        const lines = list.slice(0, 10).map((v, i) => {
          const t = v.title || v.name || 'Untitled';
          const u = v.url || v.link || v.videoUrl || '';
          const dur = v.duration ? ` · ⏱️ ${v.duration}` : '';
          return `${i + 1}. ${String(t).slice(0, 80)}${dur}\n   ${u}`;
        });
        await _reply(sock, msg,
          `🔞 *${info.label}*\n🔍 _${q}_\n\n${lines.join('\n\n')}\n\n_Download with *${P}xvdl <url>* or *${P}xnxxdl <url>*_`);
      });
  }

  // downloaders (xvideos / xnxx) — Prexzy first, then DC probes
  for (const [name, info] of Object.entries(DL_EPS)) {
    cmd([name], { desc: `${info.label} — ${P}${name} <video url>`, category: 'NSFW', adult: true },
      async (sock, msg, args) => {
        if (!(await gate(sock, msg))) return;
        let url = (args || [])[0] || '';
        if (!/^https?:/i.test(url)) {
          try {
            const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const t = q?.conversation || q?.extendedTextMessage?.text || q?.videoMessage?.caption || '';
            const m = /https?:\/\/\S+/.exec(t || ''); if (m) url = m[0];
          } catch {}
        }
        if (!/^https?:/i.test(url)) { await _reply(sock, msg, `Usage: *${P}${name} <video url>*`); return; }
        await _react(sock, msg, '🔞');
        const jid = msg.key.remoteJid;
        const wait = await sock.sendMessage(jid, { text: `🔞 *${info.label}*\n\n⬡ Resolving media...\n_URL:_ ${url.slice(0, 90)}` }, { quoted: msg });
        const edit = (t) => sock.sendMessage(jid, { text: t, edit: wait.key }).catch(() => {});

        const ep = info.match.test(url) ? info.ep : (/xnxx\./i.test(url) ? '/nsfw/xnxx-dl' : '/nsfw/xvideos-dl');
        const chain = [
          { via: `prexzy ${ep}`, fn: async () => { const r = await prexzyJson(ep, { url }, 45000); if (!r.ok) throw new Error(r.error); return pickUrl(r.data); } },
        ];
        for (const p of DC_ADULT_PATHS) {
          chain.push({ via: `davidcyril ${p}`, fn: async () => { const r = await dcGet(p, { url }, 30000); if (!r.ok) throw new Error(r.error); return pickUrl(r.data); } });
        }
        chain.push({ via: 'nexray aio', fn: async () => { const r = await nexrayAio(url); if (!r.ok) throw new Error(r.error); return r.url; } });

        const errs = [];
        for (const step of chain) {
          let media = null;
          try { media = await step.fn(); } catch (e) { errs.push(`${step.via}: ${e.message}`); continue; }
          if (!media) { errs.push(`${step.via}: no media url`); continue; }
          try {
            const f = await streamToFile(media, /xvideos|xnxx/i.test(media) ? { Referer: 'https://www.google.com/' } : {});
            await sendMedia(sock, msg, f, info.label, info.label);
            cleanTmp(f);
            try { await sock.sendMessage(jid, { delete: wait.key }); } catch {}
            return;
          } catch (e) { errs.push(`${step.via}: ${e.message}`); }
        }
        await edit(`❌ *${info.label} failed*\n\nProviders tried:\n${errs.slice(0, 6).map(x => `• ${x}`).join('\n')}\n\n_Try again shortly._`);
      });
  }

  // unified adult downloader
  cmd(['adult', 'adultdl', 'xdl', 'nsfwdl'],
    { desc: `Adult downloader (auto-routes xvideos/xnxx) — ${P}adult <url>`, category: 'NSFW', adult: true },
    async (sock, msg, args) => {
      if (!(await gate(sock, msg))) return;
      let url = (args || [])[0] || '';
      if (!/^https?:/i.test(url)) {
        try {
          const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const t = q?.conversation || q?.extendedTextMessage?.text || '';
          const m = /https?:\/\/\S+/.exec(t || ''); if (m) url = m[0];
        } catch {}
      }
      if (!/^https?:/i.test(url)) { await _reply(sock, msg, `Usage: *${P}adult <video url>*`); return; }
      const jid = msg.key.remoteJid;
      await _react(sock, msg, '🔞');
      const wait = await sock.sendMessage(jid, { text: `🔞 *Adult Downloader*\n\n⬡ Resolving...` }, { quoted: msg });
      const edit = (t) => sock.sendMessage(jid, { text: t, edit: wait.key }).catch(() => {});
      const eps = /xnxx\./i.test(url) ? ['/nsfw/xnxx-dl', '/nsfw/xvideos-dl'] : ['/nsfw/xvideos-dl', '/nsfw/xnxx-dl'];
      let media = null, lastErr = '';
      for (const ep of eps) {
        const r = await prexzyJson(ep, { url }, 45000);
        if (r.ok) { media = pickUrl(r.data); if (media) break; } else lastErr = r.error;
      }
      if (!media) {
        const nx = await nexrayAio(url);
        if (nx.ok) media = nx.url; else lastErr = nx.error;
      }
      if (!media) {
        await edit(`❌ *Adult Downloader failed*\n\n_${lastErr || 'No provider returned media.'}_\n_Use *${P}xvdl* / *${P}xnxxdl* explicitly, or try again._`);
        return;
      }
      try {
        const f = await streamToFile(media, { Referer: 'https://www.google.com/' });
        await sendMedia(sock, msg, f, 'Adult Video', 'Adult');
        cleanTmp(f);
        try { await sock.sendMessage(jid, { delete: wait.key }); } catch {}
      } catch (e) {
        await edit(`❌ Download failed.\n_${e.message}_`);
      }
    });

  // image generators
  for (const [name, info] of Object.entries(IMG_GEN)) {
    cmd([name], { desc: `${info.label} — ${P}${name} <prompt>`, category: 'NSFW', adult: true },
      async (sock, msg, args) => {
        if (!(await gate(sock, msg))) return;
        const prompt = (args || []).join(' ').trim();
        if (!prompt) { await _reply(sock, msg, `Usage: *${P}${name} <prompt>*`); return; }
        await _react(sock, msg, '🎨');
        const r = await prexzyBin(info.ep, { prompt }, 60000);
        if (!r.ok || r.kind !== 'image') {
          await _reply(sock, msg, r.rateLimited ? '⏳ Rate limited — wait ~30s and retry.' : `❌ *${info.label}* failed.\n_${r.error || 'no image returned'}_`);
          return;
        }
        await sock.sendMessage(msg.key.remoteJid, { image: r.buf, caption: `🔞 *${info.label}*\n_${prompt.slice(0, 120)}_` }, { quoted: msg });
      });
  }

  return {
    commands: Object.keys(RANDOM_CATS).length + Object.keys(SEARCH_EPS).length +
              Object.keys(DL_EPS).length + Object.keys(IMG_GEN).length + 1,
  };
}

module.exports = {
  install, RANDOM_CATS, SEARCH_EPS, DL_EPS, IMG_GEN, DC_ADULT_PATHS,
  dcGet, prexzyJson, prexzyBin, nexrayAio, giftedFb, pickUrl, streamToFile, sendMedia, cleanTmp, _sniff,
  PREXZY_BASE, DC_BASE,
};
