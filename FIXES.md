# Fix Pack — 2026-09-22

## Fixes applied
1. database/accounts.json — was NOT valid JSON (raw note text). Rewritten as a proper object preserving your note + accounts array. This crashed any code doing JSON.parse on it.
2. database/admintele.json — trailing comma (invalid JSON). Fixed.
3. mias/index.js — aio/alldl video send: FB links (esp. via cobalt) return webm/mislabeled containers → WhatsApp shows "this video isn't available". Now the buffer is re-muxed through portableVideo.cjs normalizeVideoBuffer() before sending, and mimetype is set from the actual file signature (ftyp check) instead of hardcoded video/mp4. Document fallback uses the correct mimetype too.

## Verified already OK (no changes needed)
- All ~200 .js/.cjs files pass node --check (zero syntax errors).
- mias/index.js imports lib/crash-shield.mjs — file exists at lib/crash-shield.mjs. OK.
- patch-nsfw.cjs already references .cjs files correctly (nsfwAdultPack.cjs / nsfwPrexzy.cjs).
- autoDownloader.js FB chain intact: cobalt → davidcyril → prexzy → tikwm → snapfb → fbdownloader → savefb → aioFallback, with share-link expansion using desktop UA.
- "Missing requires" flagged by naive scans in downloadWorker.js / bridge.cjs / socketWrapper.cjs / builders/index.js / kevdraPatches.js are inside comments/docs only — not real errors.

## Runtime notes
- FB "video isn't available" can ALSO mean the source link is private/login-gated or the free resolver APIs are down — the fix above solves the container/codec case, which is the common one.
- If videos still fail after deploy, check logs for "All Facebook APIs failed" — that means the upstream free APIs rejected the link, not a code bug.
