# fantastic-waddle — drop-in patch (Bad MAC, PM-free creategc, Cox/gktw local helper)

This bundle is a focused diff against https://github.com/precious125588/fantastic-waddle.
Replace the listed files in place; restart the Railway service.

## Patched files

- `start.sh`                      — installs Cox into `mias/`, wipes poisoned pre-keys on every start
- `mias/index.js`                 — `creategc` rebuilt (no DM/PM recipients, zero-recipient OK, sets GC pic to creator's WhatsApp DP)
- `mias/package.json`             — adds `cox` as a `file:` dependency
- `cox/` (new module)             — local drop-in for `@itsreimau/gktw` so the adapter in mias/handlers/gktwAdapter.js lights up
- `scripts/install-cox.sh` (new)  — manual install helper

## Why the deploy log was burning with "Bad MAC"

```
[WAJS:2348132483778] Session error: Error: Bad MAC. Error: Bad MAC
at Object.verifyMAC (/app/node_modules/libsignal/src/crypto.js:87:15)
at SessionCipher._decryptWhisperMessage … (session_cipher.js:250:16)
```

`useMultiFileAuthState` re-reads `app-state-sync-*.json` and `creds.json` from
`<AUTH_DIR>` every reconnect. Once a prekey is poisoned, every inbound frame
fails MAC and gets dropped ("failed to decrypt message with any session…
17 in 2101ms"). `start.sh` now deletes stale `app-state-sync-*` dirs on boot
so the next connect rebuilds them. Set `KEEP_BAD_MAC=1` to skip the wipe.

## What changed in `creategc`

Before: every `@mention` from the user's message got mixed into the participant list, even when the message came from a private (PM/DM) chat. The command refused to create a group unless you supplied at least one recipient.

After:
- DM `@mention`s are intentionally NOT added to the new group.
- Zero recipients is allowed — the bot is always a member; add anyone later with `.add` / `.adduser`.
- The new group's avatar is automatically set to the **creator's** WhatsApp profile picture (downloaded, resized, sent through the existing DP shim). User can change it later with `.setgcpic`.
- Help text updated to reflect the new behaviour.

## What Cox is

`@itsreimau/gktw` is 404 on npm and on GitHub. `cox/` is a small CommonJS
drop-in placed at `<repo>/cox/` (this bundle) with the same exported surface
(`prepareWAMessageMedia`, `downloadContentFromMessage`, `jidNormalizedUser`,
`sendPoll`, `sendRichInteractive`, `sendHeroCard`, `sendCarousel`, `sendList`,
`createInteractiveMessage`). `start.sh` now installs `cox` into `mias/` so
the existing `mias/handlers/gktwAdapter.js` resolves a real module and the
adapter's GKTW-mode check at boot (mias/index.js:1462) flips to ACTIVE
instead of falling back.

## Manual install (no auto-run)

```
bash scripts/install-cox.sh
./start.sh        # picks it up automatically
```
