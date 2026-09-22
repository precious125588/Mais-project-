Naruto TikTok edit replacement
==============================

Root cause
----------
The Naruto command was calling TikWM's search endpoint without its trailing
slash:

  /api/feed/search

TikWM currently returns HTTP 403 for that route. Its JSON search route is:

  /api/feed/search/

Because the Naruto shortcut only uses the hashtag search flow, every hashtag
search returned no candidates and the bot sent the "couldn't find a
downloadable TikTok edit" message.

Quality and speed fixes
-----------------------
- Every search is anchored with #narutoedit.
- The full handwritten secondary hashtag pool is retained and rotated
  randomly, so each command can use a different Naruto character/tag.
- Results without #narutoedit and obvious AI/generated/cartoon noise are
  rejected before download.
- David Cyril's TikTok downloader is the primary download path, with TikWM as
  a fallback.
- Two downloads are prepared concurrently.
- Existing small MP4s are sent without a slow re-encode. Larger or unusual
  videos are converted to portable H.264 MP4 without forced landscape padding,
  capped at 720px and 16 MB.

Replacement
-----------
Copy the files in this archive over the matching paths in the bot:

  mias/features/animeEdits.js
  tests/anime-edit-flow.test.mjs

The command remains `.naruto` (case-insensitive) and sends exactly two
deduplicated TikTok videos sourced from the allow-listed Naruto hashtags.
The existing `mias/davidcyril.js` client is used at runtime; it is already
part of the project and does not need a separate replacement.

Verification performed
----------------------
- Unit tests for command routing, hashtag rotation, filtering, and the
  two-result limit: 7 passed.
- Live TikWM hashtag search against the corrected endpoint: returned 20 rows.
- Live David Cyril downloader check: returned a working direct video URL.
- End-to-end fake WhatsApp send of `.naruto`: returned 2 valid H.264 MP4
  videos in about 8 seconds, measuring 7.7 MB and 2.6 MB in the final smoke
  run. The verified output dimensions were 768x576 and 900x720 with no forced
  black-bar canvas.