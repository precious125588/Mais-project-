PATCH v25 — REPLACEMENT FILES (fantastic-waddle)
================================================
The last push (commit ec53db0 "Add oh_men files") installed
mias/precious-fixes-v24.cjs dead-last in mias/index.js, so it overrode the
working handlers. These files undo that regression and repair the other faults.

HOW TO APPLY
------------
Option A (recommended, automatic)
  1. Copy PATCH-v25.cjs into your repo ROOT.
  2. Run:  node PATCH-v25.cjs
  3. Restart the bot (npm start).
  It is idempotent — running it twice changes nothing. Each edited file gets a
  <name>.v25bak backup the first time.

Option B (manual, drop-in)
  Copy the 4 files below over your existing ones, keeping the paths:

  mias/index.js
  mias/precious-fixes-v24.cjs
  mias/precious-gst-picker.cjs
  mias/precious-anime-edits.cjs

FILE -> FIXES APPLIED
---------------------
PATCH-v25.cjs (patcher / installer)
  - all of the edits below, idempotent, with backup + syntax-safe anchors

mias/precious-fixes-v24.cjs
  1. REMOVED the link-only .movie / .nkiri / .boost6 overrides
     (makeMovieCmd registrations). mias/index.js .movie (MynetNaija file
     picker) and precious-fixes-v21 .nkiri (Nkiri direct-file document) win
     again -> the movie/series file is delivered AS A DOCUMENT again.
  2. .ytmate now accepts a SONG NAME as well as a YouTube link
     (name -> URL via yt-search).
  3. ytDownload rewritten to the providers that actually respond + magic-number
     validation on every byte (HTML/JSON error pages can never be sent as mp4
     again) -> fixes "video isn't available / file is corrupted".
  4. .ytmate picker: audited audio/video, option 4 = video sent AS DOCUMENT.
  5. .forward: download-and-resend FIRST (any message type), native forward /
     relay only as fallback, and an honest error when nothing went out.
  6. .sudo: hardened profile-picture lookup (normalised JID, device suffix,
     @lid, 'image' then 'preview') with the bot image as last resort.
  7. The settings guard now consults the play-card pending probe.

mias/precious-gst-picker.cjs
  8. .gst posts a REAL group status: groupStatusMessageV2 envelope relayed with
     statusJidList (group JID first, then status@broadcast). The old fallback
     used sendMessage('status@broadcast'), which resolves successfully WITHOUT
     creating a ring entry -> that is why you saw "Posted to group status" with
     nothing posted. ✅ is now shown only when a relay really resolved, and a
     failure says so instead of lying.

mias/precious-anime-edits.cjs
  9. Edit/video captions are the EDIT TITLE ONLY — no "☄️ *… edit*" header, no
     👤 @author line, no 🔗 URL.

mias/index.js
 10. Exposed the play-card store (_P2_PENDING) + a chat-keyed pending map via
     globalThis.__miasPlayPending -> the settings consumer no longer steals a
     bare "4" and answers "Unknown settings option *4*". The music plays, the
     video delivers, and no settings text is printed.
 11. The play video provider chain now probes every candidate for a real VIDEO
     track (ffmpeg -i) and rejects audio-only mp4 / HTML -> no more black video
     with sound only. It tries the next provider instead.
 12. Exposed the working play providers so ytmate reuses the same chain.
 13. Exit guard: process.exit(75) / process.exit(78) from the re-pair/reconnect
     paths are suppressed for the first 3 attempts per minute, so a dropped
     socket on APK WhatsApp no longer bounces the whole bot.

NOT CHANGED (deliberately)
--------------------------
- .play / .playvid / .play2 / .movie handlers in mias/index.js, and the
  .nkiri engine in mias/precious-fixes-v21.cjs, are untouched — they are the
  pre-push behaviour you want back.
- No .gstpick / .gstcancel commands are re-added (DM picker stays removed,
  .gst / .gstatus / .groupstatus / .gcstatus post in groups).

VERIFY AFTER RESTART
--------------------
- .nkiri <title>   -> pick -> the movie/series arrives as a DOCUMENT (.mkv/.mp4)
- .movie <title>   -> pick -> file, not a bare link
- .play <song> -> reply 1/2/3/4 -> correct format, NO settings text
- .play -> 4       -> video with a real picture (not black)
- .ytmate <song or link> -> pick -> plays/downloads
- .gst <text> in a group -> ring shows the status; if it fails it says it failed
- .edits command  -> caption is just the title
- .forward <number> with a quoted message -> the message really arrives
- .sudo (<number> or run in the target's DM) -> target DP on the card