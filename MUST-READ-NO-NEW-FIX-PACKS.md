# ⚠️ MUST READ — FIX POLICY (v34, 2026-09-19)

> **NEVER create a new fix pack file. EVER.** The era of scattered fix packs
> and runtime file-patchers is **over**.

## The architecture now

- **ONE entry command everywhere**: `node server.js`
  (railway.toml, railway.json, Procfile, Dockerfile, package.json, start.sh).
- **ONE boot file**: `precious-master-fix-boot.cjs`
  - `bootParent()` (top of server.js / index.js): volume cleanup, baked-tree
    verification, session volume detection + legacy migration, session
    delete→quarantine audit, pack preflight report.
  - `bootChild()` (end of mias/index.js): crash shield, then every runtime
    command-fix module in winning order — v20 → v21 → gst-picker → v23-rc →
    v24 → v27 → v28 → v29 → tt-quote — then a verify hook that prints what is
    live 20s and 120s after boot.
- **NO runtime patching**: every old PATCH-vXX / fix_*.cjs edit is baked into
  the version-controlled files. A fresh git clone boots already-fixed.
- The `mias/precious-fixes-*.cjs` / `precious-fixes-v2*.cjs` modules are the
  command implementations. To change a fix, **edit the owning module in
  place** — never add a new pack, never add fix logic to the entry files.

## How to verify a deploy picked up the fixes

Boot log must show, in order:
```
[MASTER-FIX] ════════ PARENT BOOT (v34-merged-...) — merged fix boot ════════
[MASTER-FIX] ════════ PARENT BOOT DONE ... ════════
[MASTER-FIX] ════════ CHILD BOOT ... installing ALL runtime fix packs ════════
[packs] ════════ DONE — loaded N/N pack slots ... ════════
[packs-verify:20s] installed: v20, v21, ... | v30 build=...
```
And in WhatsApp, send **.fixcheck** — the bot replies with the live build and
which v30 fixes are armed. If the build date predates your deploy, the deploy
did not pick up the new files.
