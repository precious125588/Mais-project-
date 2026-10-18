# Neon persistence for MAIS MDX

## Current scope

The bot's 13 `mias/database.js` stores can use Neon when `DATABASE_URL` is
configured. Each bot instance is isolated by a SHA-256 scope derived from
`AUTH_DIR` (or the explicit `MIAS_DB_SCOPE` override); the unhashed session path
is not stored in Neon.

WhatsApp/Baileys credentials are stored in the additive session tables, using
the same `DATABASE_URL` as bot settings when it is configured. `SESSION_DATABASE_URL`
is only a legacy fallback and a one-time migration source. Signal keys, pairing
state, ownership markers, and temporary media remain on the existing Railway
volume. This integration does not change the authentication adapter or remove
any legacy JSON files.

## Configuration

Set `DATABASE_URL` in the existing Railway bot service's Variables to the
**pooled** PostgreSQL URL for the existing Neon project, `production` branch,
and `neondb` database. Both settings and session tables use this database.
Connection strings belong only in Railway's secret variable store. Do not put
them in `.env`, source code, logs, or an uploaded ZIP.

If sessions currently live at a different URL, keep that old URL in
`SESSION_DATABASE_URL` temporarily and follow
[`SESSION-DATABASE-UNIFICATION.md`](SESSION-DATABASE-UNIFICATION.md) to preview
and merge those records into `DATABASE_URL`. Remove the old variable only after
the deployed app reports the expected session count.

The public repository previously tracked a root `.env` file. This branch removes
it from Git while leaving the local file untouched. Before merging, set
`ADMIN_USERNAME` and a **rotated** `ADMIN_PASSWORD` in Railway Variables if the
admin login must remain available; those names are also listed in
`.env.example`. Removing the tracked file does not erase its earlier Git
history, so rotate any real value that was ever stored there.

The expected database name defaults to `neondb`. `NEON_EXPECTED_DATABASE` can
override that for a deliberate non-production test database. The startup check
confirms the current database name; the endpoint in `DATABASE_URL` must still
be selected from the intended `production` branch in the Neon console.

Without `DATABASE_URL`, the bot explicitly stays on the existing JSON-volume
mode. If the variable is set but Neon cannot be reached, startup fails closed:
the bot does not silently fall back to JSON. The safe failure log contains an
error code only, never the connection string or server error message.

## Connection check and migrations

Run the read-only probe from the bot's environment:

```sh
npm run neon:check
```

It executes only `SELECT 1` and `current_database()`, and reports success only
when the database name matches the expected value. It does not run migrations,
insert records, or print credentials.

The application applies the versioned, additive migration on startup after the
read-only readiness check. The migration creates `mias_bot_state` and the
migration ledger only; it does not drop, truncate, or modify existing tables.
On first use of a session scope, existing JSON state is copied into Neon only
when that scope has no database row. If a row already exists, its records win.
Malformed JSON prevents seeding rather than being treated as empty data.
Original JSON files are retained as a recovery copy.

For a deliberate manual schema step, run `npm run neon:migrate`. Do not point
it at production until the target endpoint and additive schema have been
reviewed. The application migration is idempotent and verifies migration
checksums.

## Data recovery

Before reverting a session to JSON mode after Neon has accepted writes, export
the latest application-state snapshot into a new directory:

```sh
npm run neon:export
```

The default output directory is a new `neon-export-<timestamp>` folder inside
the session's database directory. To choose another safe location, set
`MIAS_EXPORT_DIR` to a new, private path on the persistent volume. The export
contains only the JSON state stores, not WhatsApp auth data. Stop that bot
instance before restoring exported JSON files, and keep the original export.

Do not unset `DATABASE_URL` as a rollback shortcut after Neon writes have
started: the pre-existing JSON files will not contain those newer writes.
The schema migration is additive; recovery does not require dropping tables.

## Data retained on the volume

- Baileys `creds.json` and Signal key files, through the existing
  `useMultiFileAuthState` adapter.
- `.owner.json`, pairing records, `session_registry.json`, bot selections, and
  Telegram owner mappings.
- Guard settings and other independent JSON/config/cache files outside the
  13-store `mias/database.js` API.
- Temporary media and downloads.

This keeps the existing multi-session authentication and logout cleanup paths
unchanged. The DB merge does not log out linked devices or delete source rows.

## Local verification

```sh
npm ci --no-audit --no-fund --registry=https://registry.npmjs.org --replace-registry-host=always
npm run neon:check
npm test
npm run check:infrastructure
```

The original lockfile referenced a Replit package-mirror tarball that returned
404 during `npm ci`. The updated lock resolves packages from `registry.npmjs.org`.
The repository's existing `.npmrc` also enables `legacy-peer-deps` for the
Baileys/Jimp peer mismatch. A clean install of the updated lockfile passed with
the explicit registry override above; `npm ci` itself does not rewrite it.
