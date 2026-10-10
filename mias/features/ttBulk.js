// Bulk TikTok downloads for `.tt url1,url2,...`.
// One provider request per link, the exact format asked for, no other link,
// quality or watermark, MP4 validation before sending, and a clear reason for
// every link that fails.
import { fetchTikTokInfo, selectTikTokUrl, parseTikTokMode } from "./tiktok.js";

export const BULK_MAX_LINKS = 10;
const DOWNLOAD_TIMEOUT_MS = 90000;
const MAX_BYTES = 100 * 1024 * 1024;
const MIN_BYTES = 4096;

// The format id for a batch. Defaults to HD video (1.3) when no format is given.
export function bulkModeId(ttMode) {
  return parseTikTokMode(ttMode)?.id || "1.3";
}

// Downloads the exact requested media for one link. Throws a readable reason on failure.
export async function downloadTikTokMedia(url, modeId, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const axiosImpl = deps.axiosImpl;
  const mode = parseTikTokMode(modeId);
  if (!mode) throw new Error(`Unknown format ${modeId}`);

  const info = await fetchTikTokInfo(url, fetchImpl); // one provider request
  const mediaUrl = selectTikTokUrl(info, mode);
  if (!mediaUrl) throw new Error(`No ${mode.kind} file is available in format ${mode.id}`);

  let res;
  try {
    res = await axiosImpl.get(mediaUrl, {
      responseType: "arraybuffer",
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      maxRedirects: 5,
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.tiktok.com/" },
    });
  } catch (error) {
    throw new Error(`Media download failed: ${error?.message || error}`);
  }

  const buf = Buffer.from(res.data);
  if (buf.length < MIN_BYTES) throw new Error("Downloaded file is empty or too small");
  if (mode.kind !== "audio" && buf.subarray(4, 8).toString("latin1") !== "ftyp") {
    throw new Error("Downloaded file is not a valid MP4");
  }
  return { buf, mode };
}

// Processes each link in order. `send` receives { buf, mode, index, total, url }.
export async function runTikTokBulk({ urls, modeId, send, deps = {} }) {
  const unique = [...new Set(urls)];
  const list = unique.slice(0, BULK_MAX_LINKS);
  const skipped = unique.length - list.length;
  const failures = [];
  let sent = 0;

  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    try {
      const { buf, mode } = await downloadTikTokMedia(url, modeId, deps);
      await send({ buf, mode, index: i + 1, total: list.length, url });
      sent++;
    } catch (error) {
      failures.push({ index: i + 1, url, reason: error?.message || String(error) });
    }
    if (i < list.length - 1) await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  return { sent, failed: failures.length, failures, skipped, total: list.length };
}

export function formatBulkSummary(result) {
  const lines = [`🎵 *Batch done!*  ✅ ${result.sent} sent  ❌ ${result.failed} failed`];
  for (const f of result.failures.slice(0, 10)) lines.push(`#${f.index}: ${f.reason}`);
  if (result.skipped > 0) {
    lines.push(`Only the first ${BULK_MAX_LINKS} links were processed (${result.skipped} skipped).`);
  }
  return lines.join("\n");
}
