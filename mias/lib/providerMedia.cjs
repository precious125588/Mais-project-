'use strict';

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch { return false; }
}

function pickPrexzyVideo(data) {
  const d = data?.result || data?.data || data;
  const url = d?.download_url || d?.url || d?.video || d?.download;
  if (!isHttpUrl(url)) return null;
  return { url: String(url), title: d?.info?.title || d?.title || data?.info?.title || data?.title || 'YouTube' };
}

function hintedBytes(media) {
  const direct = Number(media?.filesize || media?.fileSize || media?.size || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  try {
    const n = Number(new URL(media.url).searchParams.get('clen'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

function quality(media) {
  const n = Number(media?.height || String(media?.quality || media?.label || '').match(/(\d{3,4})p?/i)?.[1] || 0);
  return Number.isFinite(n) ? n : 0;
}

function pickNexrayVideo(data, { maxBytes = 0 } = {}) {
  const root = data?.result || data?.data || data;
  if (!Array.isArray(root?.medias)) return null;
  let variants = root.medias.filter(m => m && String(m.type || '').toLowerCase() === 'video' && isHttpUrl(m.url));
  if (maxBytes > 0) {
    const withinLimit = variants.filter(m => !hintedBytes(m) || hintedBytes(m) <= maxBytes);
    if (withinLimit.length) variants = withinLimit;
  }
  if (!variants.length) return null;
  variants.sort((a, b) => quality(b) - quality(a));
  // Keep audio whenever a muxed format is offered, selecting the highest
  // resolution with audio first; otherwise use the highest playable video.
  const muxed = variants.filter(m => m.is_audio === true || /audio\//i.test(String(m.mimeType || '')));
  const selected = muxed[0] || variants[0];
  return { url: String(selected.url), title: root?.title || selected.title || 'YouTube', type: 'video', height: quality(selected), hasAudio: muxed.includes(selected) };
}

module.exports = { isHttpUrl, pickPrexzyVideo, pickNexrayVideo };
