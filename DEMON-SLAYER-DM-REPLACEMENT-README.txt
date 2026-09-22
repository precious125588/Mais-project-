Demon Slayer TikTok + named block/unblock replacement
=======================================================

Copy these files over the matching paths in the bot:

  mias/features/animeEdits.js
  mias/lib/animeContentFilter.js
  mias/lib/blocklist.js
  mias/index.js

The tests are included under tests/ for verification.

Anime edit behavior
-------------------
- `.demonslayer` / `.demon-slayer` now use the supplied Demon Slayer,
  Kimetsu no Yaiba, KNY, character, breathing, Upper Moon, and edit hashtags.
- One edit anchor and a rotating secondary hashtag are selected per search.
- Search is restricted to TikWM's JSON hashtag route.
- David Cyril is tried first for every TikTok download; TikWM is the fallback.
- Results are deduplicated and two valid MP4 edits are sent when available.
- Naruto keeps its existing two-result behavior and now uses the same reusable
  metadata filter before download, immediately before download, and before
  sending.

AI/animated filter
-------------------
`mias/lib/animeContentFilter.js` rejects metadata containing common AI,
generated, synthetic, deepfake, cartoon, animated, CGI, 3D-rendering,
generator-tool, and "what if" markers. It deliberately allows the word
"anime" because Demon Slayer and Naruto themselves are anime.

This is a conservative title/description/hashtag/creator-metadata gate, not
a computer-vision classifier. A TikTok that hides its provenance from all
metadata cannot be proven to be human-edited from the video bytes alone; the
source hashtag allow-list and fail-closed metadata checks still prevent the
usual AI/animated spam from reaching WhatsApp.

Block/unblock behavior
----------------------
- `.block` and `.unblock` accept a mention, reply, explicit number, or an
  exact contact name from the local WhatsApp contact store/names database.
- Exact names must resolve to one contact; ambiguous names are refused.
- Success messages and `.blocklist` display contact names instead of raw
  `+234...` numbers, with WhatsApp mentions retained for navigation.
- LID-keyed contact records are matched through their phone mapping (`pn`,
  `id`, or phone fields), so `@lid` is not displayed to the user.
- Group/status/channel targets and the bot's own account remain protected.

Verification
------------
- `node --check mias/features/animeEdits.js`
- `node --check mias/lib/animeContentFilter.js`
- `node --check mias/lib/blocklist.js`
- `node --check mias/index.js`
- `node --test tests/anime-edit-flow.test.mjs tests/blocklist.test.mjs`

Do not copy node_modules, auth/session folders, or environment files from the
development workspace into production.