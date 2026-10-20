import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TIKTOK_DOWNLOAD_MAX_BYTES, TIKTOK_DOCUMENT_MAX_BYTES } from "../mias/lib/diskGuard.js";

test("TikTok download cap covers the supplied 255 MB asset without changing other media caps", () => {
  assert.equal(TIKTOK_DOWNLOAD_MAX_BYTES, 300 * 1024 * 1024);
  assert.ok(TIKTOK_DOWNLOAD_MAX_BYTES > 255_220_084);
  assert.equal(TIKTOK_DOCUMENT_MAX_BYTES, 1024 * 1024 * 1024);

  const source = fs.readFileSync(new URL("../mias/index.js", import.meta.url), "utf8");
  assert.match(source, /const _ttMediaMaxBytes = \(ttMode\.kind === "video" && ttMode\.document\)\s*\? TIKTOK_DOCUMENT_MAX_BYTES\s*:\s*\(ttMode\.kind === "video" \|\| ttMode\.kind === "sticker"\)\s*\?\s*TIKTOK_DOWNLOAD_MAX_BYTES\s*:\s*getMediaLimitBytes\(\);/);
  assert.match(source, /const maxBytes = ttMode\.document \? TIKTOK_DOCUMENT_MAX_BYTES : TIKTOK_DOWNLOAD_MAX_BYTES;/);
  assert.match(source, /ensureDiskSpace\(_ttMediaMaxBytes\)/);
  assert.match(source, /maxContentLength: _ttMediaMaxBytes/);
  assert.match(source, /maxBodyLength: _ttMediaMaxBytes/);

  assert.match(source, /const _aioMediaMaxBytes = _isTikTok \? TIKTOK_DOWNLOAD_MAX_BYTES : getMediaLimitBytes\(\);/);
  assert.match(source, /ensureDiskSpace\(_aioMediaMaxBytes\)/);
  assert.match(source, /maxContentLength: _aioMediaMaxBytes/);
  assert.match(source, /maxBodyLength: _aioMediaMaxBytes/);
});
