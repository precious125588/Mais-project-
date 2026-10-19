# Neon Persistence for MAIS MDX

## Dedicated Database Architecture

MAIS MDX isolates settings and session storage across two separate databases:

- **Settings Database (`DATABASE_URL`)**:
  Used by `mias/database.js` to persist bot state, sudo permissions, reminders, warnings, and settings.
  Each bot instance is isolated by a SHA-256 scope derived from `AUTH_DIR`.

- **Session Database (`SESSION_DATABASE_URL`)**:
  Used by `mias/sessionPersistence.cjs` to persist WhatsApp session authentication credentials (`mias_session_auth`), session registry (`mias_session_registry`), and bot selections (`mias_bot_selections`).

## Configuration in Railway

Set the following variables in Railway:

1. `DATABASE_URL`: The pooled PostgreSQL URL for the Settings database.
2. `SESSION_DATABASE_URL`: The pooled PostgreSQL URL for the Session database.
3. `ADMIN_PASSWORD`: Admin dashboard password (username is not required).

## Web Pair and Admin UI

- Both databases are checked independently and displayed on the Web Pair homepage (`/`) and Admin Dashboard (`/admin`).
- Startup logs and health endpoints (`/api/database/status`) report the connection status of both databases.
- The Admin Panel provides a **🧹 Clean All DB** button to purge session records across both databases and local pairing directories.
