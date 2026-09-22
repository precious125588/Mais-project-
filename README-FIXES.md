# GKTW / fix-pack repair drop — 2026-09-18

## What was broken
1. `start.sh` installed the wrong package: `npm install "../${cox_pkg:-cox}/.."`
   resolves to the REPO ROOT ("/app"), so the cox install failed and the
   fallback pulled a random unrelated "cox" from npm. That is why gktw
   "wasn't installing".
2. `mias/handlers/gktwAdapter.js` never listed "cox" in GKTW_CANDIDATES, so
   even with cox present in node_modules the adapter skipped it and fell back
   to raw Baileys — the "[MIAS] GKTW — Not installed" log line.

## Files in this drop (overwrite in place)
- start.sh                        -> <repo>/start.sh
- mias/handlers/gktwAdapter.js    -> <repo>/mias/handlers/gktwAdapter.js

## Verified before packaging
- node --check passes on both files
- bash -n passes on start.sh
- cox exposes sendInteractive/sendHeroCard/sendCarousel/sendList/createInteractiveMessage
- ESM `await import('cox')` lights up the adapter detection (same code path)

## Pack audit (all 22 boot-referenced files exist and pass syntax check)
session-boot, v20, v21 (mias), gst-picker, v23-rc, play-v2, playv2-deliver,
download-worker, watermark, v24, v27, v28 + patchers fix_all, fix_session_401,
PATCH-v25, PATCH-v27, precious-fix-pack. Boot order is: server.js -> patchers
-> mias/index.js -> precious-all-packs-boot.cjs (installs v20->v24, v27, v28
dead-last). If a pack is missing in YOUR deploy, check Railway logs for the
"[packs] ❌" line and the "[manifest] N files loaded, M failed" line.

## Deploy
Copy over your repo, commit, push, redeploy. No config/session changes.
