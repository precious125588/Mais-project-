// ═══════════════════════════════════════════════════════════════════════════
// reliableDl.js — CENTRAL PUBLIC DOWNLOAD PIPELINE (verified live 2026-09-23)
// ─────────────────────────────────────────────────────────────────────────────
// Why this file exists:
//   The old chain (DavidCyril /play + /download/ytmp3, Gifted, co.wuk.sh
//   cobalt, ryzendesu, nexoracle) is DEAD:
//     • apis.davidcyriltech.my.id → now demands an API key (MISSING_API_KEY)
//     • api.giftedtech.co.ke      → empty responses
//     • co.wuk.sh / cobalt        → instances shut down
//     • api.ryzendesu.vip         → domain parked/for sale
//     • api.nexoracle.com         → returns HTML, not JSON
//   That is why .play said "no valid audio file url" and .video said
//   "All download providers are busy".
//
// Live-tested replacements (no keys needed):
//     • princetechn  ytmp3/ytmp4  → REAL CDN file URLs (savetube.vip) ✓
//     • piped mirrors             → YouTube search + metadata ✓
//     • audius / deezer / itunes  → keyless full/preview audio fallback ✓
//     • @distube/ytdl-core        → last-resort direct stream
//
// Optional env: PRINCE_API_KEY (defaults to the public "prince" key).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const PRINCE_BASE = 'https://api.princetechn.com/api/download';
const PRINCE_KEY = process.env.PRINCE_API_KEY || 'prince';
const PIPED_HOSTS = [
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.yt',
];
const AUDIUS_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

async function fetchJSON(url, { timeout = 15000, method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'user-agent': UA, accept: '*/*', ...headers },
    body, redirect: 'follow', signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + new URL(url).host);
  return res.json();
}

async function fetchBuf(url, timeout = 180000) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    redirect: 'follow', signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + new URL(url).host);
  return Buffer.from(await res.arrayBuffer());
}

function ytId(u) {
  const m = String(u || '').match(/(?:youtu\.be\/|[?&]v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── magic-byte validation (never send HTML/JSON as media again) ─────────────
function looksAudio(b) {
  if (!b || b.length < 5000) return false;
  return b.slice(0, 3).toString() === 'ID3'
      || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)          // mp3 frame
      || b.slice(4, 8).toString() === 'ftyp'                 // m4a/mp4a
      || b.slice(0, 4).toString() === 'OggS'
      || b.slice(0, 4).toString() === 'fLaC'
      || b.slice(0, 4).toString() === 'RIFF';
}
function looksVideo(b) {
  if (!b || b.length < 10000) return false;
  return b.slice(4, 8).toString() === 'ftyp'
      || (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3); // EBML
}

// ── YouTube search (piped mirrors → html scrape) ────────────────────────────
async function searchYouTube(query) {
  query = String(query || '').trim();
  if (/^https?:\/\//i.test(query) && ytId(query)) {
    return { videoId: ytId(query), url: 'https://youtu.be/' + ytId(query), title: query };
  }
  let last;
  for (const h of PIPED_HOSTS) {
    try {
      const d = await fetchJSON(h + '/search?q=' + encodeURIComponent(query) + '&filter=videos', { timeout: 9000 });
      const v = (d.items || []).find(x => x && x.url && x.url.includes('watch?v='));
      if (!v) throw new Error('no items');
      const id = v.url.split('watch?v=')[1].split('&')[0];
      return {
        videoId: id, url: 'https://youtu.be/' + id,
        title: v.title || query, author: v.uploaderName || null,
        duration: v.duration || null, views: v.viewCount || null,
        thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
      };
    } catch (e) { last = e; }
  }
  try {
    const res = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query),
      { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) });
    const html = await res.text();
    const m = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    if (m) {
      const id = m[1];
      const tm = html.match(new RegExp('"videoId":"' + id + '"[\\s\\S]{0,600}?"title":\\{"runs":\\[\\{"text":"([^"]{1,150})"'));
      return { videoId: id, url: 'https://youtu.be/' + id, title: tm ? tm[1] : query, thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
    }
  } catch (e) { last = e; }
  throw new Error('YouTube search failed: ' + (last && last.message));
}

// ── oEmbed author enrichment (never "Unknown" when YouTube knows it) ────────
async function enrichAuthor(meta) {
  if (meta && !meta.author && (meta.url || meta.videoId)) {
    try {
      const ytUrl = meta.url || ('https://www.youtube.com/watch?v=' + meta.videoId);
      const d = await fetchJSON('https://www.youtube.com/oembed?url=' + encodeURIComponent(ytUrl) + '&format=json', { timeout: 8000 });
      if (d && d.author_name) meta.author = d.author_name;
      if (d && d.title && (!meta.title || meta.title === meta.url)) meta.title = d.title;
    } catch (e) {}
  }
  return meta;
}

// ── PrinceTechn resolvers (live-verified 2026-09-23) ────────────────────────
async function princeResolve(ytUrl, kind) {
  const ep = kind === 'video' ? 'ytmp4' : 'ytmp3';
  const d = await fetchJSON(PRINCE_BASE + '/' + ep + '?apikey=' + PRINCE_KEY + '&url=' + encodeURIComponent(ytUrl), { timeout: kind === 'video' ? 60000 : 45000 });
  const r = d && (d.result || d.data);
  const u = r && (r.downloadUrl || r.download_url || r.url || r.audio || r.video || r.mp3 || r.mp4);
  if (!u || !/^https?:\/\//.test(u)) throw new Error('princetechn returned no file url');
  return { url: u, title: r.title, author: r.author, duration: r.duration, thumb: r.thumbnail };
}

// ── keyless audio fallbacks ─────────────────────────────────────────────────
async function audiusTrack(query) {
  let hosts = AUDIUS_HOSTS, last;
  try {
    const list = await fetchJSON('https://api.audius.co', { timeout: 6000 });
    if (Array.isArray(list.data) && list.data.length) hosts = [...list.data.slice(0, 3), ...AUDIUS_HOSTS];
  } catch (e) {}
  for (const h of hosts) {
    try {
      const d = await fetchJSON(h + '/v1/tracks/search?query=' + encodeURIComponent(query) + '&limit=5&app_name=mais-bot', { timeout: 12000 });
      const t = (d.data || []).find(x => x && x.is_streamable !== false) || (d.data || [])[0];
      if (!t) throw new Error('no match');
      return { url: h + '/v1/tracks/' + t.id + '/stream?app_name=mais-bot', title: t.title, artist: t.user && t.user.name, ext: '.mp3', mime: 'audio/mpeg', src: 'audius' };
    } catch (e) { last = e; }
  }
  throw last || new Error('audius failed');
}
async function deezerTrack(query) {
  const d = await fetchJSON('https://api.deezer.com/search?q=' + encodeURIComponent(query) + '&limit=5', { timeout: 10000 });
  const t = (d.data || []).find(x => x && x.preview);
  if (!t) throw new Error('no deezer match');
  return { url: t.preview, title: t.title, artist: t.artist && t.artist.name, ext: '.mp3', mime: 'audio/mpeg', src: 'deezer', preview: true };
}
async function itunesTrack(query) {
  const d = await fetchJSON('https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&media=music&entity=song&limit=5', { timeout: 10000 });
  const t = (d.results || []).find(x => x && x.previewUrl);
  if (!t) throw new Error('no itunes match');
  return { url: t.previewUrl, title: t.trackName, artist: t.artistName, ext: '.m4a', mime: 'audio/mp4', src: 'itunes', preview: true };
}

// ── PUBLIC API: resolve audio (full song first, previews last resort) ───────
async function resolveAudio(meta) {
  meta = meta || {};
  const ytUrl = meta.url || (meta.videoId ? 'https://youtu.be/' + meta.videoId : null);
  const title = meta.title || meta.query || 'audio';
  if (ytUrl) {
    try {
      const p = await princeResolve(ytUrl, 'audio');
      const buf = await fetchBuf(p.url, 180000);
      if (looksAudio(buf)) return { buf, title: p.title || title, author: p.author || meta.author, mime: 'audio/mpeg', ext: '.mp3', src: 'princetechn' };
    } catch (e) {}
  }
  for (const fn of [audiusTrack, deezerTrack, itunesTrack]) {
    try {
      const t = await fn(title);
      const buf = await fetchBuf(t.url, 120000);
      if (looksAudio(buf)) return { buf, title: t.title || title, author: t.artist || meta.author, mime: t.mime, ext: t.ext, src: t.src, preview: !!t.preview };
    } catch (e) {}
  }
  throw new Error('all audio providers failed — try again in a moment');
}

// ── PUBLIC API: resolve video ───────────────────────────────────────────────
async function resolveVideo(meta) {
  meta = meta || {};
  const ytUrl = meta.url || (meta.videoId ? 'https://youtu.be/' + meta.videoId : null);
  const title = meta.title || 'video';
  if (ytUrl) {
    try {
      const p = await princeResolve(ytUrl, 'video');
      const buf = await fetchBuf(p.url, 240000);
      if (looksVideo(buf)) return { buf, title: p.title || title, author: p.author || meta.author, mime: 'video/mp4', ext: '.mp4', src: 'princetechn' };
    } catch (e) {}
    try {
      const mod = await import('@distube/ytdl-core').catch(() => null);
      const ytdl = mod && (mod.default || mod);
      if (ytdl) {
        const info = await ytdl.getInfo(ytUrl, { requestOptions: { headers: { 'user-agent': UA } } });
        const fmt = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'audioandvideo' });
        const chunks = [];
        const stream = ytdl.downloadFromInfo(info, { format: fmt });
        await new Promise((res, rej) => {
          stream.on('data', c => chunks.push(c));
          stream.on('end', res); stream.on('error', rej);
          setTimeout(() => rej(new Error('ytdl timeout')), 180000);
        });
        const b = Buffer.concat(chunks);
        if (looksVideo(b)) return { buf: b, title: info.videoDetails?.title || title, mime: 'video/mp4', ext: '.mp4', src: 'ytdl-core' };
      }
    } catch (e) {}
  }
  throw new Error('all video providers failed — try again in a moment');
}

module.exports = {
  searchYouTube, enrichAuthor, resolveAudio, resolveVideo,
  fetchJSON, fetchBuf, ytId, looksAudio, looksVideo,
  PRINCE_BASE, PIPED_HOSTS,
};
