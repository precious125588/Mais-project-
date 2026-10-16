/**
 * TikTok metadata/download adapter.
 * Provider responses are normalized here so the command layer only deals with
 * stable fields and safe media modes.
 */
// One provider, one request. The bot sends exactly the format asked for and
// never switches to another link, quality or watermark when something is missing.
const PROVIDER = (url) => `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;

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
  const data = payload?.data || payload?.result || payload;
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

const PROVIDER_CHAIN = [
  { label: "tikwm", url: (u) => PROVIDER(u) },
  { label: "tikwm-nohd", url: (u) => `https://www.tikwm.com/api/?url=${encodeURIComponent(u)}` },
];

async function _fetchOne(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MIAS/1.0" } });
  } catch (error) {
    const err = new Error(`TikTok provider is unreachable: ${error?.message || error}`);
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
  const info = normalizeTikTokResponse(json);
  if (!info.videoHd && !info.videoSd && !info.videoWatermark && !info.audio && (!info.images || !info.images.length)) {
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
  const errors = [];
  for (const provider of PROVIDER_CHAIN) {
    try {
      return await _fetchOne(provider.url(url), fetchImpl);
    } catch (error) {
      errors.push(`${provider.label}: ${error?.message || error}`);
      // Invalid link / no-media are definitive for this URL — do not retry other providers.
      if (error?.code === "INVALID_URL" || error?.code === "NO_MEDIA") throw error;
      // FORBIDDEN / RATE_LIMIT / UNREACHABLE / BAD_RESPONSE / HTTP_* -> try next provider.
    }
  }
  const err = new Error(`All TikTok providers failed (${errors.join("; ")})`);
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

export { MODES };
