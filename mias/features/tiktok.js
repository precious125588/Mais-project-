/**
 * TikTok metadata/download adapter.
 * Provider responses are normalized here so the command layer only deals with
 * stable fields and safe media modes.
 */
// The fallback changes the API source, not the user's selected command/mode or
// delivery format. Normalization keeps provider quality/watermark fields distinct.
const PROVIDER = (url) => `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
const TIKTOK_PROVIDER_NAMES = Object.freeze([
  "tikwm",
  "prexzy",
  "nexray-tiktok",
  "nexray-aio",
  "davidcyril-rapid",
  "davidcyril",
  "giftedtech",
]);

function providerBase(value, fallback) {
  const base = String(value || fallback).trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/]+(?:\/.*)?$/i.test(base) ? base : fallback;
}

function fallbackProviderRequests(url) {
  const encoded = encodeURIComponent(url);
  const prexzy = providerBase(process.env.PREXZY_API, "https://prexzyapis.com");
  const davidCyril = providerBase(process.env.DAVIDCYRIL_API_BASE, "https://apis.davidcyril.name.ng");
  const giftedKey = encodeURIComponent(process.env.GIFTED_KEY || "gifted");
  return [
    { label: "prexzy", url: `${prexzy}/download/tiktok?url=${encoded}` },
    { label: "nexray-tiktok", url: `https://api.nexray.eu.cc/downloader/tiktok?url=${encoded}` },
    { label: "nexray-aio", url: `https://api.nexray.eu.cc/downloader/aio?url=${encoded}` },
    { label: "davidcyril-rapid", url: `${davidCyril}/download/tiktokdl-rapid?url=${encoded}` },
    { label: "davidcyril", url: `${davidCyril}/download/tiktok?url=${encoded}` },
    { label: "giftedtech", url: `https://api.giftedtech.co.ke/api/download/tiktok?apikey=${giftedKey}&url=${encoded}` },
  ];
}

const MODES = {
  "1.1": { kind: "video", quality: "sd", document: false, watermark: false },
  "1.2": { kind: "video", quality: "sd", document: true, watermark: false },
  "1.3": { kind: "video", quality: "hd", document: false, watermark: false },
  "1.4": { kind: "video", quality: "hd", document: true, watermark: false },
  "1.5": { kind: "video", quality: "sd", document: false, watermark: true },
  "1.6": { kind: "video", quality: "hd", document: false, watermark: true },
  "1.7": { kind: "video", quality: "hd", document: false, watermark: false, videoNote: true },
  "2.1": { kind: "audio", document: false, voiceNote: false },
  "2.2": { kind: "audio", document: true, voiceNote: false },
  "2.3": { kind: "audio", document: false, voiceNote: true },
  "3.1": { kind: "sticker", quality: "hd", document: false, watermark: false },
  "3.2": { kind: "sticker", quality: "sd", document: false, watermark: false },
  "4.1": { kind: "slider", quality: "best", document: false },
};

const pick = (...values) => values.find((value) => typeof value === "string" && value);

export function normalizeTikTokResponse(payload = {}) {
  const data = (payload?.data && typeof payload.data === "object")
    ? payload.data
    : ((payload?.result && typeof payload.result === "object") ? payload.result : payload);
  const rawImages = Array.isArray(data.images)
    ? data.images
    : (Array.isArray(data.image_post_info?.images)
      ? data.image_post_info.images.map((x) => x?.display_image?.url_list?.[0] || x)
      : []);
  const images = rawImages.filter((value) => typeof value === "string" && value);

  return {
    title: pick(data.title, data.desc, data.description, "TikTok video"),
    author: pick(data.author?.nickname, data.author?.unique_id, data.author, data.author_name, "Unknown author"),
    duration: data.duration || data.duration_sec || "",
    thumbnail: pick(data.cover, data.thumbnail, data.origin_cover, data.ai_dynamic_cover, data.dynamic_cover, data.music_info?.cover),
    // Every cover candidate, so the caller can try the next one when a CDN
    // link 403s — the picker should always carry the video image.
    covers: [data.cover, data.thumbnail, data.origin_cover, data.ai_dynamic_cover, data.dynamic_cover, data.music_info?.cover, ...images]
      .filter((value) => typeof value === "string" && value),
    videoHd: pick(data.hdplay, data.hd, data.play_hd, data.download_url),
    videoSd: pick(data.play, data.sd, data.wmplay),
    videoWatermark: pick(data.wmplay, data.play),
    audio: pick(data.music, data.music_info?.play, data.audio),
    images,
  };
}

const MODE_ALIASES = {
  "1": "1.1", "sd": "1.1", "video": "1.1",
  "doc": "1.2", "document": "1.2",
  "hd": "1.3",
  "hddoc": "1.4",
  "wm": "1.5", "watermark": "1.5",
  "hdwm": "1.6",
  "note": "1.7", "videonote": "1.7",
  "2": "2.1", "audio": "2.1", "mp3": "2.1", "music": "2.1",
  "audiodoc": "2.2",
  "vn": "2.3", "voice": "2.3", "voicenote": "2.3", "ptt": "2.3",
  "sticker": "3.1", "stickerize": "3.1", "stik": "3.1",
  "4": "4.1", "4.1": "4.1", "slider": "4.1", "slide": "4.1", "slides": "4.1",
  "slideshow": "4.1", "photo": "4.1", "photos": "4.1", "images": "4.1", "album": "4.1",
};

// Accepts "1.3", " 1.3 ", "*1.3*", "1 3", "1,3", "1-3", "hd", "audio", ...
export function normalizeTikTokMode(value) {
  let v = String(value || "").replace(/[*_~`>]/g, "").trim().toLowerCase();
  // WhatsApp users sometimes include the bot prefix when replying to a
  // numbered picker, e.g. ".1.3". Treat it as the same format choice.
  v = v.replace(/^[.!#$\/]+\s*/, "").trim();
  v = v.replace(/[.)]+$/, "").trim();
  if (MODE_ALIASES[v.replace(/\s+/g, "")]) return MODE_ALIASES[v.replace(/\s+/g, "")];
  const m = v.match(/^(\d+)\s*(?:[.,\-/ ]\s*(\d+))?$/);
  if (m) return m[2] ? `${m[1]}.${m[2]}` : (MODE_ALIASES[m[1]] || m[1]);
  return v;
}

export function parseTikTokMode(value) {
  const id = normalizeTikTokMode(value);
  const mode = MODES[id];
  return mode ? { ...mode, id } : null;
}

export function formatTikTokMenu(info, prefix = ".") {
  const isSlider = Array.isArray(info?.images) && info.images.length > 0;
  return [
    `*${info.title}*`,
    `Author: ${info.author}`,
    info.duration ? `Duration: ${info.duration}s` : null,
    isSlider ? `Type: 📸 Photo Slider (${info.images.length} slides)` : null,
    "",
    "Reply with the number you want:",
    "➜ [1] Video",
    "1.1 SD Video (mp4)",
    "1.2 SD Document (mp4)",
    "1.3 HD Video (mp4)",
    "1.4 HD Document (mp4)",
    "1.5 SD Video with watermark",
    "1.6 HD Video with watermark",
    "1.7 HD Video Note",
    "➜ [2] Music",
    "2.1 Audio",
    "2.2 Document Audio",
    "2.3 Voice Note",
    "➜ [3] Stickers",
    "3.1 Animated Sticker (HD)",
    "3.2 Animated Sticker (SD)",
    "➜ [4] Slider",
    `4.1 TikTok Slider (video with images & music${isSlider ? ` — ${info.images.length} slides` : ""})`,
    "",
    "Reply with a choice such as *1.3* or *4.1* within 5 minutes.",
  ].filter(Boolean).join("\n");
}

// Native WhatsApp single-select menus are the reliable "radio" path. The
// selected row id is the same value accepted by normalizeTikTokMode, so both
// taps and typed replies share one handler.
export function buildTikTokPickerSections(info = null) {
  const isSlider = Array.isArray(info?.images) && info.images.length > 0;
  const slideDesc = isSlider
    ? `Convert ${info.images.length} photo slides to video (3s each)`
    : "Convert photo slides into video with music";
  return [
    {
      title: "Video",
      rows: [
        { title: "1.1 SD Video", description: "MP4 video", id: "1.1", rowId: "1.1" },
        { title: "1.2 SD Document", description: "Send as MP4 document", id: "1.2", rowId: "1.2" },
        { title: "1.3 HD Video", description: "Best quality MP4", id: "1.3", rowId: "1.3" },
        { title: "1.4 HD Document", description: "Send HD MP4 as document", id: "1.4", rowId: "1.4" },
        { title: "1.5 SD Watermark", description: "SD video with watermark", id: "1.5", rowId: "1.5" },
        { title: "1.6 HD Watermark", description: "HD video with watermark", id: "1.6", rowId: "1.6" },
        { title: "1.7 HD Video Note", description: "Send as a video note", id: "1.7", rowId: "1.7" },
      ],
    },
    {
      title: "Music",
      rows: [
        { title: "2.1 Audio", description: "MP3 audio", id: "2.1", rowId: "2.1" },
        { title: "2.2 Document Audio", description: "Send audio as a file", id: "2.2", rowId: "2.2" },
        { title: "2.3 Voice Note", description: "Send as a voice note", id: "2.3", rowId: "2.3" },
      ],
    },
    {
      title: "Sticker",
      rows: [
        { title: "3.1 Animated Sticker", description: "HD video converted to WebP sticker", id: "3.1", rowId: "3.1" },
        { title: "3.2 Animated Sticker", description: "SD video converted to WebP sticker", id: "3.2", rowId: "3.2" },
      ],
    },
    {
      title: "Slider",
      rows: [
        { title: "4.1 TikTok Slider", description: slideDesc, id: "4.1", rowId: "4.1" },
      ],
    },
  ];
}

// P7 fix: validate the link before any provider call, then try a bounded
// provider chain. HTTP 403 from a provider is classified as an access/rate
// denial (not an invalid link) and the next healthy provider is tried.
export function isValidTikTokUrl(url) {
  if (typeof url !== "string") return false;
  const u = url.trim();
  return /^https?:\/\/(www\.|m\.|vm\.|vt\.)?tiktok\.com\/\S+/i.test(u)
      || /^https?:\/\/(vm|vt)\.tiktok\.com\/\S+/i.test(u)
      || /^https?:\/\/www\.tiktok\.com\/@[\w.]+\/(video|photo)\/\d+/i.test(u);
}

function firstHttpUrl(...values) {
  for (const value of values) {
    if (typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim())) return value.trim();
    if (Array.isArray(value)) {
      const found = firstHttpUrl(...value);
      if (found) return found;
    }
  }
  return null;
}

function extractTikTokMedia(payload) {
  const queue = [payload];
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 80) {
    const current = queue.shift();
    visited += 1;
    if (typeof current === "string") {
      const direct = firstHttpUrl(current);
      if (direct) return { title: "TikTok video", author: "Unknown author", videoHd: direct };
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 20));
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const info = normalizeTikTokResponse(current);
    const hd = firstHttpUrl(current.hdplay, current.hd_play, current.video_hd, current.videoHd, current.play_hd, current.hd);
    const sd = firstHttpUrl(current.play, current.sd, current.sdplay, current.sd_play, current.video_sd, current.videoSd, current.wmplay);
    const generic = firstHttpUrl(
      current.video, current.url, current.video_url, current.videoUrl,
      current.download_url, current.downloadUrl, current.download, current.link,
      current.nowm, current.no_watermark, current.data,
    );
    const videoHd = info.videoHd || hd || generic;
    const videoSd = info.videoSd || sd;
    const videoWatermark = info.videoWatermark || firstHttpUrl(current.wmplay, current.watermark, current.watermarked);
    const audio = info.audio || firstHttpUrl(current.music, current.audio, current.audio_url, current.audioUrl);
    if (videoHd || videoSd || videoWatermark || audio || info.images?.length) {
      return { ...info, videoHd, videoSd, videoWatermark, audio };
    }

    for (const key of ["data", "result", "response", "media", "video", "download", "links"]) {
      if (current[key] && typeof current[key] === "object") queue.push(current[key]);
      else if (typeof current[key] === "string" && /^https?:\/\//i.test(current[key])) queue.push(current[key]);
    }
  }
  return null;
}

function requestSignal(parentSignal, timeoutMs) {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return parentSignal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return parentSignal && typeof AbortSignal.any === "function"
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : parentSignal || timeoutSignal;
}

function conciseProviderError(error) {
  if (error?.status) return `HTTP ${error.status}`;
  if (error?.code === "UNREACHABLE") return "unreachable";
  return String(error?.code || "request failed").replace(/[^A-Z0-9_-]/gi, "").slice(0, 32) || "request failed";
}

async function _fetchOne(request, fetchImpl, parentSignal = null) {
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method || "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MIAS/1.0",
        Accept: "application/json",
      },
      ...(request.body === undefined ? {} : {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MIAS/1.0",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.body),
      }),
      signal: requestSignal(parentSignal, 8000),
    });
  } catch (error) {
    const err = new Error("TikTok provider is unreachable");
    err.code = "UNREACHABLE";
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`TikTok provider returned HTTP ${response.status}`);
    err.code = response.status === 403 ? "FORBIDDEN" : (response.status === 429 ? "RATE_LIMIT" : "HTTP_" + response.status);
    err.status = response.status;
    throw err;
  }
  let json;
  try {
    json = await response.json();
  } catch {
    const err = new Error("TikTok provider returned an invalid response");
    err.code = "BAD_RESPONSE";
    throw err;
  }
  const info = extractTikTokMedia(json);
  if (!info) {
    const err = new Error("TikTok provider returned no media for this link");
    err.code = "NO_MEDIA";
    throw err;
  }
  return info;
}

export async function fetchTikTokInfo(url, fetchImpl = fetch) {
  if (!isValidTikTokUrl(url)) {
    const err = new Error("Invalid TikTok link");
    err.code = "INVALID_URL";
    throw err;
  }
  const primaryError = [];
  try {
    return await _fetchOne({ label: "tikwm", url: PROVIDER(url) }, fetchImpl);
  } catch (error) {
    primaryError.push(`tikwm: ${conciseProviderError(error)}`);
  }

  // The previous "tikwm-nohd" retry hit the same TikWM host again, so a
  // provider-level 403 still left the command without an independent fallback.
  // Fan out only after the primary failure and stop once one real media result
  // arrives; each of the six secondary routes has an 8-second ceiling.
  const controller = new AbortController();
  const fallbackErrors = [];
  const attempts = fallbackProviderRequests(url).map(async (request) => {
    try {
      const info = await _fetchOne(request, fetchImpl, controller.signal);
      controller.abort();
      return info;
    } catch (error) {
      fallbackErrors.push(`${request.label}: ${conciseProviderError(error)}`);
      throw error;
    }
  });
  try {
    return await Promise.any(attempts);
  } catch {
    controller.abort();
  }
  const failures = [...primaryError, ...fallbackErrors];
  const summary = failures.join("; ");
  const allWithoutMedia = failures.length > 0 && failures.every((failure) => failure.endsWith("NO_MEDIA"));
  const err = new Error(allWithoutMedia
    ? `TikTok providers returned no media (${summary})`
    : `All TikTok providers failed (${summary})`);
  err.code = "ALL_PROVIDERS_FAILED";
  throw err;
}

// Returns only the URL for the exact format requested, or null.
// No quality or watermark substitution.
export function selectTikTokUrl(info, mode) {
  if (mode.kind === "slider") {
    return (info.images && info.images.length > 0) ? (info.images[0] || "slider") : null;
  }
  if (mode.kind === "audio") return info.audio || null;
  if (mode.watermark) return info.videoWatermark || null;
  return (mode.quality === "hd" ? info.videoHd : info.videoSd) || null;
}

export { MODES, TIKTOK_PROVIDER_NAMES };
