# Put sessions and settings in one database

The app settings database is selected with `DATABASE_URL`. WhatsApp session
auth, the session registry, and bot selections now use that same URL whenever it
is set. `SESSION_DATABASE_URL` remains only as a compatibility fallback and as
the source for a one-time copy from the old session database.

## If sessions already use a separate database

1. In the Railway service Variables, keep `DATABASE_URL` pointed at the
   existing database used by bot settings.
2. Temporarily keep `SESSION_DATABASE_URL` pointed at the old session database.
   Add or change these values only in Railway's secret variable editor; never
   commit them or paste them into chat.
3. Before deploying, run a read-only preview:

   ```sh
   npm run sessions:migrate-db
   ```

   It reports row counts only. It does not create tables or copy data.
4. When the counts look right, the Railway start command will copy the rows
   before starting the app. You can also run the copy manually once:

   ```sh
   npm run sessions:migrate-db -- --apply
   ```

   This creates the additive session tables in `DATABASE_URL` and copies auth
   files, registry rows, and bot selections. Existing destination rows win
   unless the source row has a newer `updated_at`. Source records are not
   deleted. Re-running the command is safe.
5. Verify the web pairing status shows sessions in the shared database, and
   only then remove the old `SESSION_DATABASE_URL` variable. If the copy fails,
   startup logs only an error code and temporarily falls back to the legacy
   session database; no source records are deleted.

Do not log out or delete linked WhatsApp sessions as part of this migration.
The copy preserves their credentials so they do not need to be paired again.

If `SESSION_DATABASE_URL` and `DATABASE_URL` already point at the same database,
or there is no legacy session URL, no copy is needed. Without `DATABASE_URL`,
the app retains the legacy session-only fallback; settings will not share that
database until `DATABASE_URL` is set.
