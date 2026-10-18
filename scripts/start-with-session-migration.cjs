'use strict';

const { spawn } = require('node:child_process');
const { constants: osConstants } = require('node:os');
const { runMigration } = require('./migrate-session-database.cjs');

async function prepareSessionDatabase() {
  const sourceUrl = String(process.env.SESSION_DATABASE_URL || '').trim();
  const destinationUrl = String(process.env.DATABASE_URL || '').trim();
  delete process.env.SESSION_DATABASE_MIGRATION_FAILED;

  if (sourceUrl && destinationUrl) {
    try {
      const result = await runMigration({ apply: true });
      return { mode: 'shared', migration: result };
    } catch (error) {
      process.env.SESSION_DATABASE_MIGRATION_FAILED = '1';
      const code = String(error?.code || error?.name || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '').slice(0, 80);
      console.error(`[session-startup] Database merge failed (${code}); using legacy session storage for this boot.`);
      return { mode: 'legacy-fallback', errorCode: code };
    }
  } else if (!destinationUrl && sourceUrl) {
    console.warn('[session-startup] DATABASE_URL is not configured; keeping legacy session-only storage for this boot.');
    return { mode: 'legacy-session-only' };
  }

  return { mode: destinationUrl ? 'shared' : 'json' };
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

module.exports = { prepareSessionDatabase };
