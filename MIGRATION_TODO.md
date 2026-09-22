# MIAS Migration TODO

This tracks the parts of the "Full Migration & Modernization" plan that have
NOT been completed by the incremental LATE-PATCH v17–v22 fixes. Each item
below is a rewrite-scale task that requires a live WhatsApp test device and
cannot be safely landed via a text-only patch pass.

## Done via patches (no further action required)
- v19: gst → status@broadcast (image/video/audio/sticker support)
- v19: facebook → nexray primary endpoint with fallbacks
- v20/v21: getcmd → inline monospace code (no more .js document)
- v21: image/video/audio thumbnails (jpegThumbnail interceptor)
- v21: play command uses reactions only, artwork visible to all recipients
- v21: addcmd smart parser + CommonJS shim for saved commands
- v21: 45s gst watchdog to prevent stuck 🌀
- v22: silent progress boards — "⬡ Fetching…/Downloading…" banners suppressed
- Creator gate hardcoded to 2349068551055 (both mias/index.js and case.js);
  msg.key.fromMe bypass removed so paired bot sessions cannot escalate.

## Still to do (require full rewrite, not a patch)

### Step 1 — @itsliaaa/baileys abstraction layer
Create `handlers/` with `mediaHandler.js`, `reactionHandler.js`,
`messageHandler.js`, `interactiveHandler.js`. Every existing call to
`sock.sendMessage / sendReply / react` (~1,800 call sites) must be routed
through them. Cannot be done safely without a running WA session to
regression-test each command family.

### Step 2 — Modern media pipeline
Introduce a single `sendMedia(sock, jid, type, buf, opts)` helper that
detects mime, generates thumbnails, and picks the correct Baileys shape
(image | video | audio | document | sticker). Migrate every download
command to use it.

### Step 10 — Menu redesign
Replace the current text menu with a category-grid layout that uses
Baileys interactive messages (buttons + list rows). Requires a new
`menu/render.js` module and a design pass.

### Step 11 — Interactive button system rebuild
Migrate all `.setbutton / .buttons / hijackv4` flows to
`interactiveMessage` (native buttons, list responses). The current
templateButtons path is deprecated by WA.

### Step 14–16 — Dead-code cleanup
Remove neutralized `__dup_removed_*` cases from case.js after verifying
mias/index.js covers them. Consolidate three overlapping getcmd/play
patches (v19, v20, v21) into a single implementation.

### Step 17 — Group flow overhaul
Reorganize group commands under a single controller with role-based
authorization instead of ad-hoc `isCreator / isOwner / fromGroupAdmin`
checks scattered across ~200 handlers.

### Step 19 — Test harness
Add a Vitest project that mocks a Baileys socket and runs each command
handler with a synthetic message, asserting the outbound payload shape.

## Notes
- Never delete a LATE-PATCH block; they override earlier definitions and
  removing them re-exposes the original bugs.
- Always append new patches at the END of `mias/index.js` so they win.
- The `_v21InstallInterceptor` poll grabs the live sock via `globalThis`;
  any refactor that moves the socket off `globalThis` must re-wire it.
