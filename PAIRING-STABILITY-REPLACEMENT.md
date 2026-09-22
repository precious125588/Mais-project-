# Pairing stability replacement

This bundle fixes the web WhatsApp pairing flow in the current
`precious125588/fantastic-waddle` repository.

## Replace these files

Copy the files from this archive into the project root, preserving paths:

```text
pair.js
server.js
notify.js
public/index.html
```

Keep the existing `sessionOwnership.js`, `mais_launcher.js`, and
`fix_session_401.cjs` files from the current repository. They are part of the
session handoff fix already present in that version.

## What changed

- The browser opens the live status stream before starting a pairing request, so
  connection/authentication messages are not lost.
- The server replays the current pairing state to refreshed or reconnecting
  browsers.
- The UI falls back to status polling when SSE is interrupted instead of going
  silent.
- Duplicate reconnect requests for the same WhatsApp number are collapsed.
- Late close events from an old Baileys socket can no longer reconnect or delete
  credentials belonging to a newer socket.
- Telegram connection notifications no longer block the WhatsApp handoff.
- Telegram sends have a 10-second timeout.

## Install

1. Back up the current project.
2. Extract this archive at the project root.
3. Run `npm install`.
4. Restart the service.
5. Open the pairing page, select QR or Pairing Code, and start a fresh attempt.

If an old pairing attempt is still stuck, use the page's reset/re-pair action
once before trying again. Do not reuse an old pairing code; WhatsApp pairing
codes are short-lived.

## Verification

The replacement was checked with Node syntax checks, the browser script syntax
check, the MIAS infrastructure smoke check, the status-flow tests, the
DavidCyril contract tests, and a server health/pairing-validation smoke test.