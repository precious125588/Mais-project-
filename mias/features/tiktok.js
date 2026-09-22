/**
 * TikTok metadata/download adapter.
 * Provider responses are normalized here so the command layer only deals with
 * stable fields and safe media modes.
 */
const PROVIDERS = [
  (url) => `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
  (url) => `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
];

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
};

const pick = (...values) => values.find((value) => typeof value === "string" && value);

export function normalizeTikTokResponse(payload = {}) {
  const data = payload?.data || payload?.result || payload;
  return {
    title: pick(data.title, data.desc, data.description, "TikTok video"),
    author: pick(data.author?.nickname, data.author?.unique_id, data.author, data.author_name, "Unknown author"),
    duration: data.duration || data.duration_sec || "",
    thumbnail: pick(data.cover, data.thumbnail, data.origin_cover, data.ai_dynamic_cover, data.dynamic_cover, data.music_info?.cover),
    // Every cover candidate, so the caller can try the next one when a CDN
    // link 403s — the picker should always carry the video image.
    covers: [data.cover, data.thumbnail, data.origin_cover, data.ai_dynamic_cover, data.dynamic_cover, data.music_info?.cover]
      .filter((value) => typeof value === "string" && value),
    videoHd: pick(data.hdplay, data.hd, data.play_hd, data.download_url),
    videoSd: pick(data.play, data.sd, data.wmplay),
    videoWatermark: pick(data.wmplay, data.play),
    audio: pick(data.music, data.music_info?.play, data.audio),
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
  return [
    `*${info.title}*`,
    `Author: ${info.author}`,
    info.duration ? `Duration: ${info.duration}s` : null,
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
    "",
    "Reply with a choice such as *1.3* within 5 minutes.",
  ].filter(Boolean).join("\n");
}

// Native WhatsApp single-select menus are the reliable "radio" path. The
// selected row id is the same value accepted by normalizeTikTokMode, so both
// taps and typed replies share one handler.
export function buildTikTokPickerSections() {
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
  ];
}

export async function fetchTikTokInfo(url, fetchImpl = fetch) {
  let lastError;
  for (const endpoint of PROVIDERS) {
    try {
      const response = await fetchImpl(endpoint(url), { headers: { "User-Agent": "MIAS/1.0" } });
      if (!response.ok) throw new Error(`TikTok provider returned ${response.status}`);
      const json = await response.json();
      const info = normalizeTikTokResponse(json);
      if (info.videoHd || info.videoSd || info.audio) return info;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No TikTok provider returned media");
}

export function selectTikTokUrl(info, mode) {
  if (mode.kind === "audio") return info.audio;
  if (mode.watermark) return info.videoWatermark;
  return mode.quality === "hd" ? (info.videoHd || info.videoSd) : (info.videoSd || info.videoHd);
}

export { MODES };