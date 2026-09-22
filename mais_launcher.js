// mais_launcher.js — Spawns one MAIS MDX bot child per paired number.
// Supports: launch, stop, restart, pause (stop + no auto-restart), resume, list.

const { spawn } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const chalk = require('chalk');

let registry;
try { registry = require('./nexstore/sessionRegistry'); } catch { registry = null; }

const ownership = require('./sessionOwnership');

const MIAS_ENTRY    = path.join(__dirname, 'mias', 'index.js');
const MAX_INSTANCES = parseInt(process.env.MAX_INSTANCES || '50', 10);
const MAX_BACKOFF_MS = 5 * 60 * 1000;

const running = new Map(); // jid -> { proc, sessionDir, startedAt, restartCount }
const paused  = new Set(); // jids that are intentionally paused (no auto-restart)

function selectedBotEnv(number, supplied = {}) {
    // A paired MD is always MIAS. Legacy bot-selection records are ignored so
    // stale Telegram/web choices can never boot a second runtime.
    const {
        BOT_ENTRY: _ignoredEntry,
        BOT_CWD: _ignoredCwd,
        BOT_ID: _ignoredId,
        ...safeSupplied
    } = supplied || {};
    return {
        ...safeSupplied,
        BOT_ENTRY: 'mias/index.js',
        BOT_ID: 'mias-mdx',
        BOT_NAME: process.env.BOT_NAME || 'MIAS MDX',
    };
}

function isAlive(p) {
    try { return p && !p.killed && p.exitCode === null; } catch { return false; }
}
function _backoffMs(n) {
    return Math.min(8000 * Math.pow(2, n - 1), MAX_BACKOFF_MS);
}

async function _launch(number, sessionDir, envOverrides = {}) {
    if (running.has(number) && isAlive(running.get(number).proc)) {
        console.log(chalk.gray(`↪ MAIS already running for ${number}`));
        return running.get(number);
    }
    if (running.size >= MAX_INSTANCES) throw new Error(`MAX_INSTANCES (${MAX_INSTANCES}) reached`);
    if (!fs.existsSync(sessionDir))   throw new Error(`Session dir missing: ${sessionDir}`);

    const existing     = running.get(number);
    const restartCount = existing ? (existing.restartCount || 0) : 0;

    // Normalize every launch (startup, reconnect, resume, auto-restart) to MIAS.
    envOverrides = selectedBotEnv(number, envOverrides);

    // Resolve entry point from the manifest (BOT_ENTRY), default to mias/index.js.
    // NOTE: the old code hard-required mias/index.js to exist even when the user
    // picked New Page, so a missing MIAS install blocked every other bot.
    const { BOT_ENTRY: _botEntry, BOT_CWD: _botCwd, ...safeEnvOverrides } = envOverrides;
    const botEntry = _botEntry ? path.resolve(__dirname, _botEntry) : MIAS_ENTRY;
    if (!fs.existsSync(botEntry)) throw new Error(`Bot entry not found: ${botEntry}`);

    // Working directory: manifest cwd wins, else the entry's own folder, so each
    // bot resolves its own node_modules and relative asset paths correctly.
    // case.js and the legacy data files resolve from the repository root.
    // Running the MIAS child from /mias made ./allfunc, ./database, and
    // ./setting resolve to the wrong directory and left the child apparently
    // connected but unable to process new chats.
    const botCwd = _botCwd
        ? path.resolve(__dirname, _botCwd)
        : (path.resolve(botEntry) === path.resolve(MIAS_ENTRY)
            ? __dirname
            : path.dirname(botEntry));
    if (!fs.existsSync(botCwd)) throw new Error(`Bot cwd not found: ${botCwd}`);

    const env = {
        ...process.env,
        AUTH_DIR:     sessionDir,
        BOT_NAME:     process.env.BOT_NAME     || 'MAIS MDX',
        PREFIX:       process.env.PREFIX        || '.',
        OWNER_NUMBER: process.env.OWNER_NUMBER  || '',
        MARK_ONLINE:  process.env.MARK_ONLINE   || '1',
        LOG_DEDUP:    process.env.LOG_DEDUP     || '1',
        SHIELD_NAME:  `bot:${String(number).split('@')[0]}`,
        ZERO_API_KEY: process.env.ZERO_API_KEY || '',
        PORT: '0',
        // Bot-specific env from manifest (branding, theme, version)
        ...safeEnvOverrides,
    };

    const proc = spawn(
        process.execPath,
        [
            '--expose-gc',
            '--max-old-space-size=1050',
            // Crash shield is preloaded here too, so ANY bot entry (even one
            // that forgets to import it) survives uncaught errors instead of
            // dying and triggering a respawn storm.
            '--require', path.join(__dirname, 'lib', 'crash-shield.cjs'),
            botEntry,
        ],
        { cwd: botCwd, env, stdio:['ignore','pipe','pipe'], detached:false }
    );

    const tag = chalk.magenta(`[MAIS:${number.split('@')[0]}]`);
    proc.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
    proc.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));

    proc.on('exit', (code, sig) => {
        console.log(chalk.yellow(`${tag} exited (code=${code} sig=${sig})`));
        const r = running.get(number);
        running.delete(number);
        if (registry) { try { registry.updateStatus(number,'disconnected'); } catch {} }

        // Full-server restart request from child
        if (code === 76) {
            console.log(chalk.red.bold(`🛑 ${tag} requested FULL-SERVER restart.`));
            for (const [,rr] of running) { try { rr.proc.kill('SIGTERM'); } catch {} }
            setTimeout(() => process.exit(0), 1500);
            return;
        }

        // A second MIAS child refused to open the same auth directory because
        // another live process owns its runtime lock. Restarting it would
        // recreate the exact connection-conflict loop we are preventing.
        if (code === 78) {
            console.log(chalk.gray(`${tag} duplicate runtime refused — leaving the existing session owner alone.`));
            return;
        }

        // Skip auto-restart if intentionally paused or clean stop
        if (paused.has(number)) {
            console.log(chalk.gray(`⏸ ${tag} is paused — no auto-restart.`));
            return;
        }
        const isClean = (code === 0 && !sig);

        // A bot whose session was genuinely unlinked must NOT be respawned in a
        // loop — each restart opened a socket with dead creds, got 401, and the
        // pairing side reported "disconnected / session cleared" all over again.
        if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) {
            console.log(chalk.yellow(`${tag} session is gone — not restarting. The number must be paired again.`));
            try { ownership.release(number); } catch {}
            return;
        }

        const MAX_AUTO_RESTARTS = parseInt(process.env.MAX_AUTO_RESTARTS || '8', 10);
        if ((r?.restartCount || 0) >= MAX_AUTO_RESTARTS) {
            console.log(chalk.red(`${tag} hit ${MAX_AUTO_RESTARTS} auto-restarts — giving up to avoid a crash loop.`));
            return;
        }

        if (!isClean && fs.existsSync(sessionDir)) {
            const prev  = r ? (r.restartCount||0) : 0;
            const newCt = prev + 1;
            const delay = code === 75 ? 3000 : _backoffMs(newCt);
            console.log(chalk.cyan(`🔄 Auto-restarting ${number} in ${Math.round(delay/1000)}s`));
            setTimeout(async () => {
                try {
                    if (!fs.existsSync(path.join(sessionDir,'creds.json'))) return;
                    const e = await launch(number, sessionDir, r?.envOverrides || envOverrides);
                    e.restartCount = newCt;
                    console.log(chalk.green(`✅ Auto-restart done for ${number}`));
                } catch (e) {
                    console.error(chalk.red(`⚠️ Auto-restart failed: ${e.message}`));
                }
            }, delay);
        }
    });

    // The child now owns this auth folder: the pairing side must not reconnect
    // it or delete its creds while this process is alive.
    try { ownership.handOffToBot(number, safeEnvOverrides.BOT_ID || null); } catch {}

    const entry = { proc, sessionDir, startedAt: Date.now(), restartCount, envOverrides };
    running.set(number, entry);
    paused.delete(number); // clear paused flag on fresh launch
    if (registry) { try { registry.updateStatus(number,'connected'); } catch {} }
    const launchedName = safeEnvOverrides.BOT_NAME || safeEnvOverrides.BOT_ID || 'MIAS MDX';
    console.log(chalk.green(`✓ Spawned ${launchedName} for ${number} (pid=${proc.pid})`));
    return entry;
}

function stop(number) {
    const r = running.get(number);
    if (!r) return false;
    try { r.proc.kill('SIGTERM'); } catch {}
    running.delete(number);
    if (registry) { try { registry.updateStatus(number,'disconnected'); } catch {} }
    return true;
}

// Pause: stops the bot and prevents auto-restart until resume() is called
function pause(number) {
    paused.add(number);
    const stopped = stop(number);
    if (registry) { try { registry.updateStatus(number,'paused'); } catch {} }
    console.log(chalk.blue(`⏸ Paused MAIS for ${number}`));
    return stopped;
}

// Resume: clears paused flag and relaunches
async function resume(number) {
    if (!paused.has(number) && running.has(number) && isAlive(running.get(number).proc)) {
        return false; // already running
    }
    paused.delete(number);
    // Find sessionDir from last run or scan nexstore/pairing
    const last = running.get(number);
    let sessionDir = last?.sessionDir;
    if (!sessionDir) {
        const PAIRING_DIR = require('path').join(__dirname,'nexstore','pairing');
        const candidate   = require('path').join(PAIRING_DIR, number);
        if (require('fs').existsSync(require('path').join(candidate,'creds.json'))) {
            sessionDir = candidate;
        }
    }
    if (!sessionDir || !fs.existsSync(sessionDir)) {
        console.log(chalk.yellow(`⚠️ No session dir found for ${number} — cannot resume`));
        return false;
    }
    try {
        await launch(number, sessionDir, last?.envOverrides || {});
        console.log(chalk.green(`▶️ Resumed MAIS for ${number}`));
        return true;
    } catch (e) {
        console.error(chalk.red(`Resume failed for ${number}: ${e.message}`));
        return false;
    }
}

async function restart(number) {
    const r = running.get(number);
    const sessionDir = r?.sessionDir;
    if (!sessionDir) return false;
    console.log(chalk.cyan(`🔄 Restarting MAIS for ${number}…`));
    stop(number);
    await new Promise(res => setTimeout(res, 3000));
    try { await launch(number, sessionDir, r?.envOverrides || {}); return true; }
    catch (e) { console.error(chalk.red(`Restart failed: ${e.message}`)); return false; }
}

function isPaused(number) { return paused.has(number); }

function list() {
    return [...running.entries()].map(([number,r]) => ({
        number, pid:r.proc.pid, alive:isAlive(r.proc),
        uptimeMs:Date.now()-r.startedAt, restarts:r.restartCount||0,
        paused: paused.has(number),
    }));
}

// Also include paused-but-not-running entries
function listAll() {
    const base = list();
    const inBase = new Set(base.map(r=>r.number));
    for (const jid of paused) {
        if (!inBase.has(jid)) base.push({ number:jid, pid:null, alive:false, uptimeMs:0, restarts:0, paused:true });
    }
    return base;
}

// ── Single-flight launches ──────────────────────────────────────────────────
// launch() awaits (progress messages, the 6s socket-handover sleep, spawn).
// Two selector taps that land inside that window both passed the `running`
// check and spawned TWO children for one number: duplicate replies and
// "connection replaced" session fights. Concurrent callers now share one
// in-flight promise, so exactly one process is ever created per number.
const _inFlight = new Map();

function launch(number, sessionDir, envOverrides = {}) {
    const pending = _inFlight.get(number);
    if (pending) {
        console.log(chalk.gray(`↪ Launch already in progress for ${number} — joining it`));
        return pending;
    }
    const p = _launch(number, sessionDir, envOverrides)
        .finally(() => { _inFlight.delete(number); });
    _inFlight.set(number, p);
    return p;
}

process.on('exit', () => { for (const [,r] of running) { try { r.proc.kill('SIGTERM'); } catch {} } });
module.exports = { launch, stop, restart, pause, resume, isPaused, list, listAll };
