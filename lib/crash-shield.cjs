'use strict';
/* ───────────────────────────────────────────────────────────────────────────
 * CRASH SHIELD (CommonJS)
 *
 * One shared guard for the web server and every spawned bot process.
 *  • uncaughtException / unhandledRejection never kill the process
 *  • known-noisy, harmless errors (EPIPE, ECONNRESET, ETIMEDOUT, Baileys
 *    "Connection Closed"/"Timed Out") are downgraded to a single line
 *  • a real crash *loop* (many fatals in a short window) still exits so the
 *    supervisor/launcher can restart cleanly instead of thrashing forever
 *  • SIGTERM / SIGINT run registered cleanups, then exit 0
 * Usage:  require('./lib/crash-shield.cjs').install({ name: 'server' })
 * ─────────────────────────────────────────────────────────────────────────── */

const BENIGN = [
  'EPIPE', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
  'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_WRITE_AFTER_END',
  'Connection Closed', 'Timed Out', 'Socket closed', 'rate-overlimit',
];

let installed = false;
let config = null;
const cleanups = new Set();

function describe(err) {
  if (err instanceof Error) return `${err.message}\n${err.stack || ''}`.trim();
  try { return typeof err === 'string' ? err : JSON.stringify(err); }
  catch { return String(err); }
}

function isBenign(text) {
  return BENIGN.some((sig) => text.includes(sig));
}

function install(options) {
  const opts = options || {};
  const name = opts.name || process.env.SHIELD_NAME || 'process';
  const windowMs = Number(opts.windowMs || process.env.SHIELD_WINDOW_MS || 60000);
  const maxFatal = Number(opts.maxFatal || process.env.SHIELD_MAX_FATAL || 25);
  const exitCode = Number(opts.exitCode || 75); // launcher treats 75 as "restart me"

  // A preload (`node --require lib/crash-shield.cjs`) installs with defaults;
  // a later explicit install() from app code just re-configures it.
  if (installed) {
    config.name = name;
    config.windowMs = windowMs;
    config.maxFatal = maxFatal;
    config.exitCode = exitCode;
    return { onCleanup };
  }
  installed = true;
  config = { name, windowMs, maxFatal, exitCode };

  let fatals = [];

  const handle = (kind) => (err) => {
    const text = describe(err);
    if (isBenign(text)) {
      console.warn(`[SHIELD:${config.name}] ignored ${kind}: ${text.split('\n')[0]}`);
      return;
    }
    console.error(`[SHIELD:${config.name}] ${kind}: ${text}`);

    const now = Date.now();
    fatals = fatals.filter((t) => now - t < config.windowMs);
    fatals.push(now);
    if (fatals.length >= config.maxFatal) {
      console.error(
        `[SHIELD:${config.name}] ${fatals.length} fatal errors in ${Math.round(config.windowMs / 1000)}s — ` +
        `exiting with ${config.exitCode} so the supervisor can restart cleanly.`,
      );
      runCleanups();
      process.exit(config.exitCode);
    }
  };

  process.on('uncaughtException', handle('uncaughtException'));
  process.on('unhandledRejection', handle('unhandledRejection'));
  process.on('rejectionHandled', () => {});
  process.on('warning', (w) => {
    if (w && w.name === 'MaxListenersExceededWarning') return;
    console.warn(`[SHIELD:${config.name}] warning: ${w && w.message ? w.message : w}`);
  });

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`[SHIELD:${config.name}] ${sig} — shutting down.`);
      runCleanups();
      process.exit(0);
    });
  }

  console.log(`[SHIELD:${name}] crash shield active (max ${maxFatal} fatals / ${Math.round(windowMs / 1000)}s)`);
  return { onCleanup };
}

function onCleanup(fn) {
  if (typeof fn === 'function') cleanups.add(fn);
  return () => cleanups.delete(fn);
}

function runCleanups() {
  for (const fn of cleanups) { try { fn(); } catch {} }
  cleanups.clear();
}

module.exports = { install, onCleanup, describe, isBenign };

// Allow `node --require ./lib/crash-shield.cjs app.js` to self-install.
if (process.env.SHIELD_AUTOINSTALL !== '0') install({});
