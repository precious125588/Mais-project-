'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { constants: osConstants } = require('node:os');
const { normalizePostgresConnectionString } = require('../mias/lib/pgConnection.cjs');

async function clearSessionsFromSettingsDb(settingsUrl) {
  if (!settingsUrl) return { cleared: false, reason: 'no_settings_db' };
  let pg;
  try {
    pg = require('pg');
  } catch {
    return { cleared: false, reason: 'pg_missing' };
  }
  const { Pool } = pg;
  let pool;
  try {
    pool = new Pool({
      connectionString: normalizePostgresConnectionString(settingsUrl),
      max: 1,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      ssl: { rejectUnauthorized: true },
      application_name: 'mais-clear-settings-db-sessions',
    });
    const client = await pool.connect();
    try {
      let clearedRows = 0;
      for (const table of ['mias_session_auth', 'mias_session_registry', 'mias_bot_selections']) {
        const check = await client.query('SELECT to_regclass($1) AS tbl', [`public.${table}`]);
        if (check.rows[0]?.tbl) {
          const countRes = await client.query(`SELECT count(*)::bigint AS cnt FROM public.${table}`);
          const count = Number(countRes.rows[0]?.cnt || 0);
          if (count > 0) {
            await client.query(`TRUNCATE TABLE public.${table} CASCADE`);
            clearedRows += count;
          }
        }
      }
      if (clearedRows > 0) {
        console.log(`[session-startup] Cleared ${clearedRows} legacy session records from Settings DB (DATABASE_URL).`);
      }
      return { cleared: true, clearedRows };
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`[session-startup] Notice checking Settings DB for legacy sessions: ${err.message}`);
    return { cleared: false, error: err.message };
  } finally {
    if (pool) {
      try { await pool.end(); } catch {}
    }
  }
}

async function initSessionDatabase(sessionUrl) {
  if (!sessionUrl) return { initialized: false, reason: 'no_session_db' };
  let pg;
  try {
    pg = require('pg');
  } catch {
    return { initialized: false, reason: 'pg_missing' };
  }
  const { Pool } = pg;
  let pool;
  try {
    pool = new Pool({
      connectionString: normalizePostgresConnectionString(sessionUrl),
      max: 1,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      ssl: { rejectUnauthorized: true },
      application_name: 'mais-init-session-db',
    });
    const client = await pool.connect();
    try {
      const sqlPath = path.join(__dirname, '..', 'mias', 'migrations', '0002_create_whatsapp_sessions.sql');
      if (fs.existsSync(sqlPath)) {
        await client.query(fs.readFileSync(sqlPath, 'utf8'));
      }
      const countRes = await client.query('SELECT count(DISTINCT session_id)::int as count FROM mias_session_auth');
      const count = Number(countRes.rows[0]?.count || 0);
      console.log(`[session-startup] Session DB initialized on SESSION_DATABASE_URL (${count} session(s) present).`);
      return { initialized: true, count };
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`[session-startup] Warning initializing Session DB: ${err.message}`);
    return { initialized: false, error: err.message };
  } finally {
    if (pool) {
      try { await pool.end(); } catch {}
    }
  }
}

async function prepareSessionDatabase() {
  const sessionUrl = String(
    process.env.SESSION_DATABASE_URL ||
    process.env.SESSION_DB_URL ||
    process.env.SESSIONS_DATABASE_URL ||
    ''
  ).trim();
  const settingsUrl = String(process.env.DATABASE_URL || process.env.SETTINGS_DATABASE_URL || '').trim();

  // Clear legacy sessions from Settings DB if present
  if (settingsUrl) {
    await clearSessionsFromSettingsDb(settingsUrl);
  }

  // Ensure Session DB schema is ready if configured
  if (sessionUrl) {
    await initSessionDatabase(sessionUrl);
  }

  console.log(`[DB] Settings Database : ${settingsUrl ? 'Attached (DATABASE_URL)' : 'Not Attached (local JSON)'}`);
  console.log(`[DB] Session Database  : ${sessionUrl ? 'Attached (SESSION_DATABASE_URL)' : 'Not Attached (local files)'}`);

  return {
    mode: 'isolated',
    settingsAttached: Boolean(settingsUrl),
    sessionAttached: Boolean(sessionUrl),
  };
}

async function main() {
  await prepareSessionDatabase();
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!stopping && server.exitCode === null) {
        stopping = true;
        server.kill(signal);
      }
    });
  }

  server.on('error', (error) => {
    const code = String(error?.code || error?.name || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '').slice(0, 80);
    console.error(`[session-startup] Could not launch server (${code}).`);
    process.exitCode = 1;
  });
  server.on('exit', (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal);
      process.exitCode = 128 + (osConstants.signals[signal] || 1);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (require.main === module) {
  main().catch((error) => {
    const code = String(error?.code || error?.name || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '').slice(0, 80);
    console.error(`[session-startup] Startup preparation failed (${code}).`);
    process.exitCode = 1;
  });
}

module.exports = { prepareSessionDatabase, clearSessionsFromSettingsDb, initSessionDatabase };
