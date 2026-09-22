Naruto hashtag replacement
==========================

Replacement files:

  mias/features/animeEdits.js
  tests/anime-edit-flow.test.mjs

What changed:

- Added the supplied Naruto, Boruto, character, clan, ability, Otsutsuki,
  edit, AMV, and 4K hashtag pool to the Naruto TikTok fetcher.
- Removed duplicate hashtags case-insensitively before searches are built.
- Removed duplicate results by TikTok video ID and by canonical URL, so the
  same edit is not returned again through a different hashtag or URL variant.
- Kept the existing #narutoedit search anchor and the two-result Naruto limit.

Verification:

- `node --check mias/features/animeEdits.js`
- `node --check tests/anime-edit-flow.test.mjs`
- `node --test tests/anime-edit-flow.test.mjs` — 8 passed
- `git diff --check` — passed

Copy the two replacement files over the matching paths in the project. This
archive does not include deployment files, credentials, auth/session folders,
or node_modules.