// Makes a TikTok download playable in WhatsApp.
// The provider's MP4 can carry broken H.264 access units, which WhatsApp shows as
// "something is wrong with the video file". Every TikTok video is therefore
// re-encoded to clean H.264/AAC with the moov atom at the front. Resolution is kept;
// the bitrate is capped so a 30 MB source lands near 13 MB.
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { normalizeVideoBuffer } = require("../lib/portableVideo.cjs");

export const TT_VIDEO_ENCODE = Object.freeze({
  preset: "veryfast",
  crf: 26,
  maxrate: "6M",
  bufsize: "12M",
  maxInputBytes: 120 * 1024 * 1024,
  timeoutMs: 240000,
  // The source carries thousands of corrupt packets; ffmpeg logs each one.
  maxBuffer: 32 * 1024 * 1024,
});

export async function prepareTikTokVideo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 1024) {
    throw new Error("TikTok returned an empty video, so nothing was sent.");
  }
  const out = await normalizeVideoBuffer(buf, TT_VIDEO_ENCODE);
  if (out === buf) {
    throw new Error("This TikTok video could not be prepared for WhatsApp (re-encode failed, timed out or the file is too large), so nothing was sent.");
  }
  return out;
}
