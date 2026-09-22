# PRECIOUS x MIAS MDX — FIX PACK (drop-in, no re-pair after deploy)

Repo: https://github.com/precious125588/fantastic-waddle

---

## What was wrong

Your Railway volume is mounted at **`/app/nexstore`** (railway.toml → `[[volumes]] mountPath`).
But the WhatsApp credentials were being written **outside** it:

| File | Old session path | On the volume? |
|---|---|---|
| `index.js` | `./nexstore/pairing/` (relative) | ✔ but resolved against CWD |
| `pair.js` | `path.join(__dirname,'nexstore','pairing')` | ✔ |
| `autoload.js`, `case.js` | repo-relative | ✔ |
| **`mias/index.js`** (the actual bot child) | **`process.env.AUTH_DIR`, fallback `<repo>/prezzy_auth`** | ✘ |

…and on top of that, **three code paths hard-deleted the session folder**:

```
mias/index.js:2281   fs.rmSync(AUTH_DIR, {recursive:true, force:true})   // 401 / logout
mias/index.js:16696  fs.rmSync(AUTH_DIR, {recursive:true, force:true})
pair.js (9×)         deleteFolderRecursive(<session dir>)
server.js:441        fs.rmSync(d, {recursive:true, force:true})          // purge endpoint
```

So every redeploy could start with a wiped (or image-layer-only) auth folder → **re-pair**.
`MAX_AUTO_RESTARTS` was also only 8, so a live session was abandoned after 8 retries.

---

## What this pack changes

### 1. Session persistence (pair ONCE)
* **NEW** `sessionPaths.js` — single resolver. Order: argument → `SESSION_DIR` env →
  **`/app/nexstore/pairing` (auto-detected mounted volume)** → `<repo>/nexstore/pairing`.
* **NEW** `precious-session-boot.cjs` — on boot: creates the volume session root and
  **migrates** any session an older build left in `prezzy_auth/`, `auth_info_baileys/`,
  `session/` … **into the volume**, so the link you already have is not lost by the next deploy.
* **NEW** `precious-session-fix.cjs` — on boot: rewrites any remaining
  `fs.rmSync(<session>)` / `deleteFolderRecursive(<session>)` into
  `quarantineDir()` → the folder is **renamed aside, never deleted**.
* **`fix_all.cjs`** — calls both new scripts every boot.
* **`pair.js`** — `PAIRING_ROOT` now = the shared resolver; all 9 `deleteFolderRecursive`
  calls on session folders → quarantine.
* **`server.js` / `index.js` / `autoload.js` / `deploy/deploymentManager.js`** — use the
  shared resolver; no repo-relative session path left.
* **`railway.toml` / `Dockerfile` / `.env.example`** — volume at `/app/nexstore`,
  `ENV SESSION_DIR=/app/nexstore/pairing`, `MAX_AUTO_RESTARTS=999`.
* `nexstore_modules/sessionPaths.js` — mirror, because the volume overlays `nexstore/`.

### 2. Button mode cleaned
* removed the **PING** quick-reply button and the **ALL COMMANDS** quick-reply + list row
  from the interactive menu (`sendMenuV2`), both handler + native-flow fallback paths
* removed PING from `_menuButtonsPayload()` and from the rich-mode card
* removed **`cmd("ping")`** and **`cmd(["allmenu","allcmds","fullmenu","listall"])`**
* removed both names from the command registry list and the `.allmenu` line in the text menu

### 3. Anime removed
* deleted the **`{ name: "ANIME" }` category** from `MENU_CATEGORIES`
* deleted the anime commands: `animedl/animedownload/anime4k`, `anime`, `waifu`, `neko`, `foxxgirl`
* unhooked `createAnimeEditFlow` (import, factory, `registerCommands`, `statusEditFlow.animeFlow`)
  — no dangling reference remains

### 4. `.play` rebuilt
Sends a **player image card**: cover thumbnail + **Title, Author, Duration, Views**, then:

```
1 = Audio      2 = Document (.mp3)      3 = Voice note      4 = Video (mp4)
```

The user **quotes the card with the number** and gets exactly that format
(20-minute window). Implemented with `_P2_PENDING` keyed by the sent message id +
a `messages.upsert` listener that reacts only to a single-digit reply that quotes the card.

---

## Install

Copy these over the same paths in your repo (they are in this zip):

```
sessionPaths.js                 -> /sessionPaths.js
precious-session-boot.cjs       -> /precious-session-boot.cjs
precious-session-fix.cjs        -> /precious-session-fix.cjs
precious-play-v2.js             -> /precious-play-v2.js   (source of the .play block)
nexstore_modules/sessionPaths.js-> /nexstore_modules/sessionPaths.js
mias/index.js                   -> replace
pair.js / server.js / index.js / autoload.js / fix_all.cjs  -> replace
deploy/deploymentManager.js     -> replace
railway.toml / Dockerfile / .env.example -> replace
```

Railway → service → **Settings**: volume mount path **`/app/nexstore`**, replicas **1**.
Variables (optional): `SESSION_DIR=/app/nexstore/pairing`, `MAX_AUTO_RESTARTS=999`.

On boot the logs must show:

```
[precious-session-boot] session root = /app/nexstore/pairing
[precious-session-boot] volume mounted at /app/nexstore = YES ✓
[precious-session-fix] mias/index.js: rewrote 2 destructive session delete(s) → quarantine ✓
```

---

## Verified

* `node --check` passes on every modified/added file (11 files).
* `sessionPaths` resolves to the mounted volume when `/app/nexstore` exists, and to
  `<repo>/nexstore/pairing` otherwise.
* After the repair pass: `ping` = 0, `allmenu` = 0, `ANIME` category = 0,
  `BTN:…ping` = 0, dangling `animeEditFlow` = 0.
* Session deletes remaining in `pair.js` after the pass: 0 on session folders
  (the quarantine helper itself is the only remaining `deleteFolderRecursive` body).
