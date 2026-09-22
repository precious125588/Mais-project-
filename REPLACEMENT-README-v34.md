# MAIS MDX — v34 merged-fixes replacement build (2026-09-19)

## Why your fixes were not applied to WhatsApp after pairing

1. **Split-brain entry points** — Railway booted `node PATCH-v30.cjs && node
   PATCH-v31.cjs && node server.js` (railway.toml startCommand overrides the
   Dockerfile's `npm start`), `npm start` ran a different chain, and `start.sh`
   ran a third. Some fix steps ran on some entry points only.
2. **Runtime patching on a fresh clone** — the PATCH-vXX scripts rewrote files
   at boot. One injected block (`__V27_PACK_ENTRY__` in
   precious-all-packs-boot.cjs) installed precious-fixes-v27 AT REQUIRE TIME —
   before v20/v21/v24 — so later packs overwrote v27's handlers. Its fixes
   silently "weren't applied".
3. **Double installs** — mias/index.js also required v20 and v27 directly,
   bypassing the loader's dedup registry: handlers wrapped twice, ordering
   races decided which fix won.
4. **"0 paired sessions on the volume"** (your screenshot) — every
   WhatsApp-facing fix lives in the bot CHILD (mias/index.js), spawned per
   paired number. With 0 usable sessions on /app/nexstore, no child spawned,
   so no command fix could load at all.
5. **"patcher list not found" then "APPLIED (exit 0)"** — PATCH-v31 failed to
   patch index.js but still exited 0, so the log claimed success while the
   patch was half-applied.

## What v34 does

- One start command everywhere: `node server.js`.
- One boot file: `precious-master-fix-boot.cjs` (parent + child). All old
  patchers / preflight / verify / session-boot / session-fix / all-packs-boot
  / fix_pack_runtime / fix_pack_child are MERGED INTO IT and DELETED.
- v27 installs in its correct slot (after v24, before v28/v29). v20's inline
  install now sets the loader marker. No double installs, no overwrite races.
- Session deletes are quarantined (baked), legacy session dirs auto-migrate
  into the volume, and the sweeper runs on every boot.

## Deploy

1. Replace the whole repo working tree with this zip's contents (or commit it
   and push — Railway redeploys on push). Because extracting a zip cannot
   delete old files, remove the paths in DELETE-THESE-FILES.txt first if you
   extract over an existing checkout.
2. Redeploy on Railway (volume stays mounted at /app/nexstore).
3. **Pair the bot once more** (the session lands on the volume and survives
   redeploys from now on).

## Verify

- Boot log shows `[MASTER-FIX] PARENT BOOT (v34-merged-2026-09-19)` then
  `CHILD BOOT ... packs=N/N` after pairing.
- `[packs-verify:20s] installed: v20, v21, gstPicker, v23rc, v24, v27, v28, v29 ...`
- In WhatsApp: send **.fixcheck** — the bot reports the live build + armed fixes.
