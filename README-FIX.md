# MAIS MDX — fix for "paired, then instantly disconnected with 401"

## What was actually wrong

Two different processes were driving the **same** WhatsApp auth folder
(`nexstore/pairing/<number>`):

1. `pair.js` — the pairing socket, which also auto-reconnects.
2. `mias/index.js` — the bot process spawned by `mais_launcher.js`, started with
   `AUTH_DIR` pointing at that very same folder.

WhatsApp allows exactly **one** live connection per linked-device identity. The
moment the bot connected, WhatsApp kicked the other socket with **401**.

`pair.js` read that 401 as "the user unlinked the device" and ran
`forceCleanupSession()`, which deletes the auth folder (plus three more delete
sweeps at 250 ms / 1.5 s / 5 s) — out from under the running bot. The bot then
also got a 401, deleted `AUTH_DIR` itself, the launcher restarted it with no
credentials, and you saw this on repeat, ~10 seconds apart:

```
✅ USER CONNECTED     11:47:53
❌ USER DISCONNECTED  11:48:04   Reason: 401 — logged out/unlinked
🧹 Session cleared — pair again
```

Every reconnect path in `pair.js` (`401` grace reconnect, `515`, `440`, the
generic retry) called `queuePairing()` again — including after the number had
already been handed over to its bot — which re-created the conflict each time.

## The fix

**`sessionOwnership.js`** (new) — one source of truth for who owns a session,
persisted to `<sessionDir>/.owner.json` so it survives a restart of the web
process. Only the current owner may reconnect or delete a session.

**`pair.js`**
- Never opens a pairing socket for a number a bot already owns.
- The handoff flag is now sticky (it used to be cleared on the first close, so
  the follow-up 401 fell through to the "logged out" branch and wiped the
  session).
- 401 while the bot owns the identity is logged and ignored — no card, no wipe.
- `forceCleanupSession()` refuses to delete a bot-owned session unless forced.
- A genuine unlink (`DisconnectReason.loggedOut`, or a confirmed 401 with no bot
  running) still releases ownership and clears the session as before.
- The hourly sweeper skips bot-owned folders.

**`deploy/deploymentManager.js`**
- Ownership is recorded **before** the pairing socket is closed, so the 401 for
  the replaced connection already finds the right owner.
- Handoff settle time raised from 1.5 s to 6 s so WhatsApp actually releases the
  identity before the child claims it.

**`mais_launcher.js`**
- Claims ownership for the child on launch.
- Stops respawning when `creds.json` is gone (that loop is what turned one bad
  disconnect into an endless flap).
- Caps auto-restarts at 8 (`MAX_AUTO_RESTARTS`).

**`fix_session_401.cjs`** (new) — patches `mias/index.js` at startup so the bot
only deletes its own credentials on a **confirmed** logout, never during the
90-second handoff settle window. Idempotent; wired into the `start`, `dev` and
`postinstall` scripts in `package.json`.

## Installing

Copy these files over your repo, keeping the paths:

```
pair.js
mais_launcher.js
sessionOwnership.js          (new)
fix_session_401.cjs          (new)
package.json
deploy/deploymentManager.js
```

Then restart. `mias/index.js` is patched automatically on boot — do not edit it
by hand.

## Expected behaviour after the fix

Pair once → `✅ USER CONNECTED` → the bot is handed the session → the pairing
socket closes quietly (`🤝 ... keeping session`) → the bot stays online. The
`❌ USER DISCONNECTED / Session cleared` card now only appears when the device is
genuinely unlinked from your phone.
