MAIS MDX — "Bot Logged Out / Connection Failure" fix
====================================================

Symptom
-------
You pair successfully, WhatsApp shows the device linked, then a few
moments later:
  * WhatsApp stops replying to any command
  * Telegram says "MAIS MDX — Bot Logged Out! Reason: Connection Failure"
  * the linked-devices page shows the device as logged out
  * the session folder is wiped and nothing restarts

Root causes found
-----------------
1. pair.js handed the session to the MIAS child but left the pairing
   socket's creds.update listener and its two intervals alive on the SAME
   auth folder. A late write from the dying pairing socket overwrote the
   keys the child had already rotated, so WhatsApp rejected the child with
   <failure reason="401"> -> Boom("Connection Failure").

2. mias/index.js treated ANY 401 as a confirmed logout: it quarantined the
   session, told Telegram the bot was logged out and refused to reconnect.
   A 401 right after pairing is usually recoverable.

3. sessionOwnership.js wrote .owner.json into <repo>/nexstore/pairing/<digits>
   while the session (and the bot's AUTH_DIR) could be
   <volume>/nexstore/pairing/<number>@s.whatsapp.net. The "handoff in
   progress" marker therefore never reached the bot, so its 401 grace
   window never applied.

What changed
------------
* pair.js        — full retireSocket() on handoff (listeners + timers), and
                   the handoff timestamp is recorded.
* mias/index.js  — new 401 policy: only an explicit unlink
                   (device_removed / logged out) is terminal. Any other 401
                   is retried with backoff while the session is young
                   (10 min) or the handoff is settling (5 min), and up to
                   MAX_401_RETRIES (default 4) attempts otherwise. Telegram
                   is only alerted on a confirmed logout.
* sessionOwnership.js — resolves the session root exactly like pair.js and
                   the bot (SESSION_DIR / Railway volume / repo fallback)
                   and reads/writes .owner.json for BOTH folder spellings.

Install
-------
Copy these files over the same paths in your project and redeploy:
  pair.js
  sessionOwnership.js
  mias/index.js

Optional env var: MAX_401_RETRIES (default 4).

After deploying, pair the number again once. The session should stay up.
