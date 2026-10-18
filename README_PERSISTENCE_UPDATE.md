# WhatsApp Session Persistence & Complete Logout Cleanup for Neon + Railway

### 1. Bot Survival on Restart & Deployments
- Whenever a WhatsApp session pairs or updates its credentials (`creds.update`), all auth files (noise keys, pre-keys, app state sync keys) are automatically stored in the Neon PostgreSQL database (`mias_session_auth`).
- On server restart, container redeployment, or fresh clone, `autoload.js`, `mais_launcher.js`, and `mias/index.js` automatically check Neon DB and reconstitute session folders if missing on disk.
- Your bot and all paired numbers survive any deployment or reboot seamlessly!

### 2. Complete File & Space Cleanup on Logout
- When a user logs out, unlinks, or an admin deletes/resets a session:
  - Database records in `mias_session_auth`, `mias_session_registry`, `mias_bot_selections`, and scoped state are removed.
  - The local session directory and credentials files are completely deleted.
  - All `.quarantine-*` directories for that number are permanently wiped so disk space is retained.
  - Temporary pairing files, QR files, code files, and notifications are removed.

### 3. Live Webpage Display
- The homepage and admin panel show real-time Neon connection status and the number of active sessions stored in the database.
