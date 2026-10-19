# Dedicated Dual-Database Architecture

MAIS MDX uses two dedicated, isolated databases:

1. **Settings Database (`DATABASE_URL`)**:
   Stores all bot state, settings, sudo lists, reminders, warnings, and configurations.
   It does **not** store session files or authentication secrets. Any legacy session records in `DATABASE_URL` are cleared on startup.

2. **Session Database (`SESSION_DATABASE_URL`)**:
   Exclusively stores WhatsApp session authentication keys, session registry, and active bot selections.

## Railway Configuration

Configure two PostgreSQL connection URLs in Railway service Variables:

- `DATABASE_URL`: Connection string for the Settings database.
- `SESSION_DATABASE_URL`: Connection string for the dedicated Session database.
- `ADMIN_PASSWORD`: Your admin panel password (password-only login, no username required).

## Status and Monitoring

- **Web Pairing Page (`/`)**: Displays both **Settings DB** and **Session DB** status pills and detail rows in real-time.
- **Admin Panel (`/admin`)**: Displays both databases in the status bar and the System stats cards.
- **Admin Actions**: Includes **🧹 Clean All DB** to safely purge session tables and disk state when resetting the environment.
