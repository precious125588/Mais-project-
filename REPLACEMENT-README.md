# MAIS MDX replacement files — picker, Telegram sticker, archive, and pin fixes

These files are drop-in replacements for the matching paths in
`precious125588/fantastic-waddle`.

## Install

1. Extract this ZIP at the repository root and replace existing files,
   preserving the directory paths.
2. Rebuild/reinstall dependencies on the host, then restart the one supported
   entrypoint:

   ```bash
   npm install --no-audit --no-fund
   node server.js
   ```

3. Confirm the child boot log contains the v27 and TT quote packs. In
   WhatsApp, run `.fixcheck` after the bot reconnects.

Do not run old `PATCH-v*.cjs` scripts after installing this bundle. They can
reintroduce the old command-registration order.

## Fixed commands

- **TikTok picker replies**: replies such as `1.1`, `.1.1`, and replies to
  native/interactive TikTok cards now reach the same picker consumer. The
  source TikTok URL is also included in the card so the selection can be
  rebuilt after a reconnect.
- **`.archive` / `.unarchive`**: with no argument, the current chat is used.
  A DM target can be supplied as a single number or spaced number:

  ```text
  .archive 2349068551855
  .archive 234 906 855 1855
  .unarchive 234 906 855 1855
  ```

- **`.pin`**: quoted messages are unwrapped through ephemeral, view-once,
  document-caption, and interactive wrappers. The supported `{ pin: key }`
  WhatsApp action is attempted before legacy fallbacks.
- **`.tgsticker`**: the suspended DavidCyril endpoint is retried and its
  failure is reported clearly. For a provider-independent fallback, set the
  deployment secret/environment variable `TELEGRAM_BOT_TOKEN`; the bot then
  uses Telegram's official `getStickerSet`, `getFile`, and file download
  endpoints. Never paste that token into chat or commit it to the repository.

## Verification performed

- All four changed JavaScript files pass `node --check`.
- Focused quote-routing and pin-payload mock checks pass.
- The dependency-light test subset passes: 21 tests, 21 passed.
- The full suite still needs `npm install`; this checkout had no
  `node_modules`, so the three dependency-heavy test files could not start.