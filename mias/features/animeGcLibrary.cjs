// =========================================================================
//  animeGcLibrary.cjs · SOURCE 3 — WhatsApp Anime GC Library (ADDITIVE)
// ─────────────────────────────────────────────────────────────────────────
//  A dedicated WhatsApp "library" number (+2348152433778) sits in anime
//  group chats. Whenever ANY participant posts a TikTok URL in one of the
//  14 registered anime groups, the URL is normalized, de-duplicated and
//  persisted immediately to disk (edits/_gc_library.json). The bot's anime
//  commands can then serve those links as a THIRD source alongside the
//  existing repository zip links (source 1) and the existing TikTok
//  hashtag/page discovery (source 2). Nothing existing is replaced.
//
//  Safety properties:
//   • The shared library is common to every bot session; used-history stays
//     per session inside precious-anime-edits.cjs (seen keys are
//     "source:contentId").
//   • attach() registers exactly ONE messages.upsert listener per socket
//     object (WeakSet + socket flag) — reconnects never double-index.
//   • A disconnected library account, an unavailable group, or a DB error
//     NEVER crashes the main bot: every public function fails closed.
//   • Only the TikTok URL index is stored. No participant personal data, no
//     WhatsApp media is archived.
// =========================================================================
'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── dedicated library account ────────────────────────────────────────────
const LIBRARY_NUMBER = '+2348152433778';
const LIBRARY_DIGITS = '2348152433778';

// ── the 14 registered anime GC routes (invite link is config/discovery
//    only; the resolved group JID is the runtime identifier) ─────────────
const ROUTES = Object.freeze([
  { key: 'demonslayer',    label: 'Demon Slayer',     invite: 'https://chat.whatsapp.com/CN6sIYHohds0UiTVQKw6F6' },
  { key: 'jjk',            label: 'JJK',              invite: 'https://chat.whatsapp.com/HnEaeyf9n9y1mQfuN8mVbv' },
  { key: 'naruto',         label: 'Naruto',           invite: 'https://chat.whatsapp.com/F6uPvHnLosIHbgIC1gvWwM' },
  { key: 'dragonball',     label: 'Dragon Ball',      invite: 'https://chat.whatsapp.com/Lf05ggqi9KJA2NyhRS2Tvp' },
  { key: 'bleach',         label: 'Bleach',           invite: 'https://chat.whatsapp.com/DKkEOrOMXlEE8XzeyHDDn7' },
  { key: 'onepiece',       label: 'One Piece',        invite: 'https://chat.whatsapp.com/F4VbgTSGn6N8ckuDHXh7fE' },
  { key: 'mha',            label: 'My Hero Academia', invite: 'https://chat.whatsapp.com/K4p63ahLeBg4gvLDU87dHN' },
  { key: 'sololeveling',   label: 'Solo Leveling',    invite: 'https://chat.whatsapp.com/JTbCxx5jJl7HIqMCXscpBN' },
  { key: 'aot',            label: 'Attack on Titan',  invite: 'https://chat.whatsapp.com/Hm7W4be6POlGCldLj6Rass' },
  { key: 'chainsawman',    label: 'Chainsaw Man',     invite: 'https://chat.whatsapp.com/Eow2X0hvZoW0OfOheGmrkK' },
  { key: 'blackclover',    label: 'Black Clover',     invite: 'https://chat.whatsapp.com/EDN3H6gL8yjD4gSj8Lt8wN' },
  { key: 'onepunchman',    label: 'One Punch Man',    invite: 'https://chat.whatsapp.com/E84W1s2ADGNEII8xShiH32' },
  { key: 'bluelock',       label: 'Blue Lock',        invite: 'https://chat.whatsapp.com/EefUVjk41ZqJAGJ7g7Bj4g' },
  { key: 'tokyorevengers', label: 'Tokyo Revengers',  invite: 'https://chat.whatsapp.com/J3fk2ys6kNaClf61YPiaAP' },
]);

// ── storage locations (reuse the repo's existing edits/ data folder) ─────
function editsDir() {
  const a = path.join(__dirname, '..', '..', 'edits');
  if (fs.existsSync(a)) return a;
  const b = path.join(__dirname, '..', 'edits');
  if (fs.existsSync(b)) return b;
  return a;
}
function storeDir()   { return process.env.ANIME_GC_DIR || editsDir(); }
function storePath()  { return path.join(storeDir(), '_gc_library.json'); }
function groupsPath() { return path.join(storeDir(), '_gc_groups.json'); }

// ── in-memory state (always backed by disk; never RAM-only) ─────────────
let _links  = null;   // { links: { contentId: record } }
let _groups = null;   // { routes: { key: { jid, label, invite, available, resolvedAt } } }
const _attachedSocks = new WeakSet();
let _librarySock  = null;
let _bannerDone   = false;
let _routesDone   = false;

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch { return fallback; }
}

function writeJson(file, value) {
  // tmp-then-rename so a crash mid-write can never corrupt the library.
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch (e) {
    try { console.warn('[ANIME-LIB] save failed:', e && e.message); } catch {}
  }
}

function loadLinks() {
  if (!_links) {
    const data = readJson(storePath(), { links: {} });
    if (!data.links || typeof data.links !== 'object') data.links = {};
    _links = data;
  }
  return _links;
}
function saveLinks() { if (_links) writeJson(storePath(), _links); }

function loadGroups() {
  if (!_groups) {
    const data = readJson(groupsPath(), { routes: {} });
    if (!data.routes || typeof data.routes !== 'object') data.routes = {};
    for (const r of ROUTES) {
      const rec = data.routes[r.key] && typeof data.routes[r.key] === 'object' ? data.routes[r.key] : {};
      data.routes[r.key] = {
        jid: typeof rec.jid === 'string' ? rec.jid : '',
        label: r.label,
        invite: r.invite,
        available: rec.available === true,
        resolvedAt: rec.resolvedAt || 0,
      };
    }
    _groups = data;
  }
  return _groups;
}
function saveGroups() { if (_groups) writeJson(groupsPath(), _groups); }

// ── TikTok URL handling ──────────────────────────────────────────────────
function normalizeTikTokUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)tiktok\.com$/.test(host)) return null;        // vm./vt./m./www. all end in tiktok.com
  const cleanPath = u.pathname.replace(/\/+$/, '');
  if (!cleanPath || cleanPath === '/') return null;         // bare homepage is not content
  return `https://${host}${cleanPath}`;                     // query/tracking params dropped
}

function contentId(raw) {
  const norm = normalizeTikTokUrl(raw);
  if (!norm) return null;
  const m = norm.match(/\/(?:video|photo)\/(\d{10,25})/i);
  if (m) return 'ttv_' + m[1];
  return 'tth_' + crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

function extractTikTokUrls(text) {
  const out = [];
  const ids = new Set();
  const re = /(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*tiktok\.com\/[^\s<>"'`\]}){]*/gi;
  const s = String(text || '');
  let m;
  while ((m = re.exec(s)) !== null) {
    // strip trailing punctuation / emoji that chat apps glue onto pasted links
    let raw = m[0].replace(/[^\x21-\x7e]+$/g, '').replace(/[.,!?;:…~*_]+$/g, '');
    const norm = normalizeTikTokUrl(raw);
    if (!norm) continue;
    const cid = contentId(norm);
    if (!cid || ids.has(cid)) continue;
    ids.add(cid);
    out.push(norm);
  }
  return out;
}

// ── WhatsApp message helpers ─────────────────────────────────────────────
function unwrapMessage(m) {
  let cur = m || {};
  for (let i = 0; i < 10 && cur; i++) {
    const n = cur.ephemeralMessage?.message
      || cur.viewOnceMessage?.message
      || cur.viewOnceMessageV2?.message
      || cur.viewOnceMessageV2Extension?.message
      || cur.documentWithCaptionMessage?.message
      || cur.editedMessage?.message;
    if (!n) break;
    cur = n;
  }
  return cur || {};
}

function messageText(m) {
  const x = unwrapMessage(m);
  return String(
    x.conversation
    || x.extendedTextMessage?.text
    || x.imageMessage?.caption
    || x.videoMessage?.caption
    || x.documentMessage?.caption
    || '',
  );
}

function routeByJid(jid) {
  const groups = loadGroups();
  for (const r of ROUTES) {
    if (groups.routes[r.key]?.jid === jid) return r;
  }
  return null;
}

// ── collector: one incoming message → zero or more new library entries ──
function handleMessage(msg) {
  try {
    const jid = msg?.key?.remoteJid;
    if (!jid || typeof jid !== 'string') return 0;
    if (!jid.endsWith('@g.us')) return 0;        // ignores DMs, status@broadcast, newsletters
    const route = routeByJid(jid);
    if (!route) return 0;                        // unregistered group → ignore
    const text = messageText(msg?.message || {});
    if (!text || !/tiktok\.com/i.test(text)) return 0;   // plain talk / emoji / stickers / other links
    const urls = extractTikTokUrls(text);
    if (!urls.length) return 0;
    const store = loadLinks();
    let added = 0;
    for (const url of urls) {
      const cid = contentId(url);
      if (!cid || store.links[cid]) continue;    // duplicate → ignore
      store.links[cid] = {
        id: cid,
        url,
        route: route.key,
        source: 'library_gc',
        groupJid: jid,
        messageId: msg?.key?.id || '',
        ts: Date.now(),
      };
      added++;
    }
    if (added) {
      saveLinks();
      console.log(`[ANIME-LIB] +${added} ${route.label} | total=${countForRoute(route.key)}`);
    }
    return added;
  } catch (e) {
    try { console.warn('[ANIME-LIB] collector error:', e && e.message); } catch {}
    return 0;                                    // never crash the main bot
  }
}

// ── socket attach (idempotent — safe across reconnects) ─────────────────
function socketDigits(sock) {
  const fromSock = String(sock?.user?.id || sock?.authState?.creds?.me?.id || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  if (fromSock) return fromSock;
  const envHint = String(process.env.AUTH_DIR || process.env.SHIELD_NAME || process.env.BOT_PHONE || '').replace(/[^0-9]/g, '');
  if (envHint && envHint.includes(LIBRARY_DIGITS)) return LIBRARY_DIGITS;
  return '';
}

function attach(sock) {
  try {
    if (!sock || !sock.ev || typeof sock.ev.on !== 'function') return false;
    if (_attachedSocks.has(sock) || sock.__animeGcAttached) return true;
    _attachedSocks.add(sock);
    try { Object.defineProperty(sock, '__animeGcAttached', { value: true, configurable: true }); } catch {}
    sock.ev.on('messages.upsert', (update) => {
      try {
        const msgs = update?.messages || [];
        for (const m of msgs) handleMessage(m);
      } catch (e) {
        try { console.warn('[ANIME-LIB] upsert error:', e && e.message); } catch {}
      }
    });
    if (socketDigits(sock) === LIBRARY_DIGITS) {
      _librarySock = sock;
      printConnectedBanner();
      refresh(sock).then(() => printRouteHealth()).catch(() => {});
    }
    return true;
  } catch { return false; }
}

// ── group resolution / health check (library account only) ──────────────
async function refresh(sock) {
  const s = sock || _librarySock;
  const isLibrary = !!s && socketDigits(s) === LIBRARY_DIGITS;
  const groups = loadGroups();
  if (!isLibrary) return groups;                 // other sessions only report stored state

  let partIds = null;
  if (typeof s.groupFetchAllParticipating === 'function') {
    try { partIds = new Set(Object.keys(await s.groupFetchAllParticipating() || {})); } catch {}
  }

  for (const route of ROUTES) {
    const rec = groups.routes[route.key];
    try {
      if (rec.jid && (!partIds || partIds.has(rec.jid))) {
        rec.available = true;
      } else {
        const code = route.invite.split('/').pop();
        let jid = '';
        try { const info = await s.groupGetInviteInfo?.(code); jid = info?.id || ''; } catch {}
        if (!jid) { try { jid = await s.groupAcceptInvite?.(code); } catch {} }
        if (typeof jid === 'string' && jid.endsWith('@g.us')) {
          rec.jid = jid;
          rec.available = true;
          rec.resolvedAt = Date.now();
        } else {
          rec.available = false;
        }
      }
      // Library groups are an index, not an archive: keep history visible so
      // old links stay referenceable; disappearing messages OFF (best-effort,
      // silently ignored when the account is not a group admin).
      if (rec.available && rec.jid && typeof s.groupToggleEphemeral === 'function') {
        try { await s.groupToggleEphemeral(rec.jid, 0); } catch {}
      }
    } catch {
      rec.available = false;                     // one bad group never kills the library
    }
    groups.routes[route.key] = rec;
  }
  saveGroups();
  return groups;
}

// ── counts / reporting ───────────────────────────────────────────────────
function counts() {
  const store = loadLinks();
  const byRoute = {};
  let total = 0;
  for (const rec of Object.values(store.links)) {
    byRoute[rec.route] = (byRoute[rec.route] || 0) + 1;
    total++;
  }
  return { byRoute, total };
}
function countForRoute(key) { return counts().byRoute[key] || 0; }

// Is the library account paired at all? (complete creds on disk)
function libraryCredsExist() {
  try {
    const candidates = [
      '/app/nexstore/pairing/' + LIBRARY_DIGITS + '@s.whatsapp.net',
      path.join(__dirname, '..', '..', 'nexstore', 'pairing', LIBRARY_DIGITS + '@s.whatsapp.net'),
    ];
    try {
      const sp = require('../../sessionPaths');
      candidates.unshift(sp.sessionDirFor(LIBRARY_DIGITS));
    } catch {}
    for (const dir of candidates) {
      const credFile = path.join(dir, 'creds.json');
      if (fs.existsSync(credFile)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
          if (creds && creds.registered === true && creds.me && creds.me.id) return true;
        } catch {}
      }
    }
    return false;
  } catch { return false; }
}

function routeHealthLines() {
  const { byRoute, total } = counts();
  const groups = loadGroups();
  const lines = ['', '👥 ANIME GC ROUTES'];
  let avail = 0;
  for (const r of ROUTES) {
    const rec = groups.routes[r.key];
    if (rec && rec.available && rec.jid) {
      avail++;
      lines.push(`✅ ${r.label} — ${byRoute[r.key] || 0} links`);
    } else {
      lines.push(`⚠️ ${r.label} — group unavailable`);
    }
  }
  lines.push('');
  lines.push(`📊 GC anime routes: ${avail}/${ROUTES.length} available`);
  lines.push(`🔗 Total indexed GC links: ${total}`);
  lines.push(`🎯 New-link discovery: ${_librarySock ? 'ACTIVE' : 'STANDBY'}`);
  return lines;
}

function printStartupBanner() {
  if (_bannerDone) return;
  _bannerDone = true;
  const lines = [
    '🎬 ANIME EDIT SYSTEM',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '📦 Repo anime source: ACTIVE',
    '🔎 TikTok hashtag source: ACTIVE',
    '',
    '📱 ANIME GC LIBRARY',
  ];
  if (_librarySock || libraryCredsExist()) {
    lines.push(`✅ Library number connected: ${LIBRARY_NUMBER}`);
    lines.push('🎬 GC route animes: CONNECTED');
  } else {
    lines.push(`⚠️ GC route animes isn't connected`);
    lines.push(`📞 Library number: ${LIBRARY_NUMBER}`);
  }
  try { console.log(lines.join('\n')); } catch {}
}

function printConnectedBanner() {
  try {
    console.log([
      '📱 ANIME GC LIBRARY',
      `✅ Library number connected: ${LIBRARY_NUMBER}`,
      '🎬 GC route animes: CONNECTED',
    ].join('\n'));
  } catch {}
}

function printRouteHealth() {
  if (_routesDone) return;
  _routesDone = true;
  try { console.log(routeHealthLines().join('\n')); } catch {}
}

function statusText() {
  const lines = ['📱 ANIME GC LIBRARY'];
  if (_librarySock || libraryCredsExist()) {
    lines.push(`✅ Library number connected: ${LIBRARY_NUMBER}`);
    lines.push('🎬 GC route animes: CONNECTED');
    lines.push(...routeHealthLines());
  } else {
    lines.push(`⚠️ GC route animes isn't connected`);
    lines.push(`📞 Library number: ${LIBRARY_NUMBER}`);
  }
  return lines.join('\n');
}

// ── source-3 feed for the anime engine ───────────────────────────────────
function linksFor(routeKey) {
  const store = loadLinks();
  const out = [];
  for (const rec of Object.values(store.links)) {
    if (rec.route !== routeKey) continue;
    out.push({ url: rec.url, caption: '', hashtags: '', src: 'library_gc', cid: rec.id });
  }
  return out;
}

// test-only: drop in-memory caches so a fresh temp store can be loaded
function _resetForTests() {
  _links = null;
  _groups = null;
  _bannerDone = false;
  _routesDone = false;
}

module.exports = {
  LIBRARY_NUMBER,
  LIBRARY_DIGITS,
  ROUTES,
  attach,
  refresh,
  handleMessage,
  linksFor,
  contentId,
  normalizeTikTokUrl,
  extractTikTokUrls,
  messageText,
  counts,
  countForRoute,
  printStartupBanner,
  statusText,
  storePath,
  groupsPath,
  _resetForTests,
};
