# MIAS fix pack v30 — replacement files

Replace these files in your deployed bot, then restart it completely:

```text
mias/index.js
mias/handlers/gktwAdapter.js
cox/index.js
lib/universalButtons.js
PATCH-v29.cjs
```

Do not copy auth folders, `.env`, `node_modules`, or lockfiles from this drop.

## 1. Bot replies invisible to everyone but the command user — FIXED

Every card and menu was relayed inside a `viewOnceMessage` envelope. Regular
WhatsApp renders that envelope only for the device that is allowed to "open"
it, so other members of the group saw nothing at all.

- `cox/index.js` and `mias/handlers/gktwAdapter.js`: the default
  `BUTTON_MODE=auto` order is now `direct → viewonce` instead of
  `viewonce → direct`.
- `lib/universalButtons.js`: sends the bare interactive payload first and only
  falls back to the wrapped form if the direct relay is rejected.
- `mias/index.js` (v30 block): a socket-level guard unwraps any remaining
  `viewOnceMessage` envelope that contains an interactive / buttons / list /
  template payload, on every socket, including sockets created after a
  reconnect. Real view-once media (`.vv`) is left untouched.

## 2. `.tt` / `.tiktok` / `.ttdl` going silent — FIXED

The handler is wrapped so it can never end without answering:

- an exception now replies `❌ TikTok failed: <reason>` instead of dying quietly
- a 90 second watchdog replies with a timeout notice if the provider hangs

## 3. Quote-reply input added

Reply to any message that holds a link or a title and run the command with no
arguments — the quoted text becomes the query. Enabled for:

`.nkiri` `.dcnkiri` `.savetube` `.movie` `.moviedl` `.boost6` `.tt` `.tiktok`
`.ttdl` `.play` `.song` `.video`

A URL inside the quoted message is preferred; otherwise the whole line is used
as the search query.

## 4. "My fixes disappear after every deploy" — CAUSE FOUND

`PATCH-v29.cjs` rewrote `mias/index.js` on disk at boot and appended a late
boot hook that re-installed older handlers **on top of** whatever was fixed.
Two consequences:

1. every deploy started from a different baseline file
2. the marker guard (`__V29_PATCHED__`) made it print "already patched" and
   exit even when the edits had never landed, so a genuinely unpatched deploy
   looked patched

`PATCH-v29.cjs` now detects the `__V30_PATCHED__` marker in `mias/index.js`
and does nothing. The fixes live in the file itself, which is what gets
deployed.

## 5. `.fixcheck` — prove what is running

New command `.fixcheck` (aliases `.v30`, `.buildinfo`) prints:

- the build tag
- process start time and uptime
- ✅/❌ for the visibility fix, the TikTok guard, and the quote-reply list

If the build tag is older than your last deploy, the deploy did not pick up
the new `mias/index.js` — that is the check to run before assuming a fix
failed.

## Verify after deploy

1. `.fixcheck` → all three lines ✅
2. Run any card command in a group and ask another member if they can see it
3. `.tt <link>` → card appears, reply `1.1` → media arrives
4. Reply to a message containing a movie title and send `.nkiri` with no text

All five files were syntax-checked, and the visibility unwrap, socket guard and
quoted-text extraction were unit-tested in isolation. A live WhatsApp session
is not available here, so the on-device tap still needs your Camon 17P.
