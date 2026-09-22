/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           RESOURCE MANAGER — MAIS MDX                          ║
 * ║  Detects and FIXES memory leaks, listener leaks, cache bloat.  ║
 * ║  Interval registry prevents duplicate setInterval leak.         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import os from "os";

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;  // 30 minutes
const MEMORY_WARN_PCT     = 80;               // warn at 80% heap used
const MEMORY_CLEAN_PCT    = 90;               // force GC + aggressive clean at 90%
const MAX_CACHE_SIZE      = 5000;             // soft cap per tracked map
const STALE_TTL_MS        = 30 * 60 * 1000;  // 30-min TTL for stale entries
// Only auto-remove listeners when count is this many times above the limit
// (avoids removing intentional multi-listener setups at borderline counts).
const AUTOFIX_MULTIPLIER  = 2;

// ── Registered caches: { ref, name, ttlMs } ──────────────────────────────────
const _trackedCaches = [];
let _cleanupTimer = null;
let _lastCleanup  = null;
let _cleanupStats = { runs: 0, entriesRemoved: 0, listenersFixed: 0, intervalsDeduped: 0, lastRun: null };

// ── Interval registry ─────────────────────────────────────────────────────────
// Keeps a named registry of intervals so calling registerInterval() with the
// same name cancels the previous interval before creating a new one.
// This prevents the commonest source of interval leaks: calling setInterval()
// inside a reconnect loop without clearing the previous handle.
const _intervalRegistry = new Map(); // name → { id, ms, label }

/**
 * Register a named interval. If an interval with this name already exists
 * it is cleared before the new one is created, eliminating the duplicate.
 *
 * @param {string}   name   Unique name for this interval (e.g. "keepalive.presence")
 * @param {Function} fn     Function to call on each tick
 * @param {number}   ms     Interval period in milliseconds
 * @returns {ReturnType<typeof setInterval>} The new interval handle
 */
export function registerInterval(name, fn, ms) {
  if (_intervalRegistry.has(name)) {
    const prev = _intervalRegistry.get(name);
    clearInterval(prev.id);
    _cleanupStats.intervalsDeduped++;
    console.log(`[ResourceManager] Replaced duplicate interval "${name}" (was ${prev.ms}ms, now ${ms}ms)`);
  }
  const id = setInterval(fn, ms);
  if (id?.unref) id.unref();
  _intervalRegistry.set(name, { id, ms, created: Date.now() });
  return id;
}

/** Cancel a named interval and remove it from the registry. */
export function clearRegisteredInterval(name) {
  if (_intervalRegistry.has(name)) {
    clearInterval(_intervalRegistry.get(name).id);
    _intervalRegistry.delete(name);
  }
}

/** Return a snapshot of all registered intervals (for diagnostics). */
export function getIntervalRegistry() {
  const now = Date.now();
  return [..._intervalRegistry.entries()].map(([name, v]) => ({
    name,
    ms: v.ms,
    ageMin: Math.round((now - v.created) / 60000),
  }));
}

// ── Register a cache for automatic cleanup ────────────────────────────────────
export function trackCache(mapOrObj, name, ttlMs = STALE_TTL_MS) {
  _trackedCaches.push({ ref: mapOrObj, name, ttlMs });
}

// ── Listener leak detection AND fix ──────────────────────────────────────────
/**
 * Audit event listeners on an EventEmitter.
 * When autoFix=true (default), removes the oldest excess listeners whenever
 * the count exceeds AUTOFIX_MULTIPLIER × maxPerEvent.
 * Always logs warnings for counts above maxPerEvent.
 *
 * @param {object}  emitter      EventEmitter (e.g. sock.ev)
 * @param {string}  label        Name for log messages
 * @param {number}  maxPerEvent  Warn threshold per event name
 * @param {boolean} autoFix      Whether to actually remove excess listeners
 * @returns {string[]}           Array of warning strings
 */
export function auditListeners(emitter, label = "emitter", maxPerEvent = 15, autoFix = true) {
  if (!emitter || typeof emitter.eventNames !== "function") return [];
  const warnings = [];
  let fixed = 0;

  for (const evt of emitter.eventNames()) {
    const count = emitter.listenerCount(evt);
    if (count <= maxPerEvent) continue;

    warnings.push(`${label}.${evt}: ${count} listeners (limit ${maxPerEvent})`);

    // Only auto-remove when clearly leaking (>= 2x limit) and rawListeners available
    if (autoFix && count >= maxPerEvent * AUTOFIX_MULTIPLIER && typeof emitter.rawListeners === "function") {
      try {
        const all       = emitter.rawListeners(evt);
        const keepCount = maxPerEvent;
        // Keep the NEWEST listeners (tail), remove the OLDEST (head).
        // This is safe because Baileys pushes listeners with .on(); the oldest
        // ones are from previous socket instances that were never cleaned up.
        const toRemove  = all.slice(0, all.length - keepCount);
        let removedCount = 0;
        for (const fn of toRemove) {
          try {
            // rawListeners may return wrapped (once) listeners — unwrap if needed
            const actual = fn?.listener ?? fn;
            emitter.removeListener(evt, actual);
            removedCount++;
          } catch {}
        }
        if (removedCount > 0) {
          fixed += removedCount;
          _cleanupStats.listenersFixed += removedCount;
          console.log(`[ResourceManager] Fixed ${removedCount} leaked listeners on ${label}.${evt} (kept ${keepCount})`);
        }
      } catch (e) {
        console.warn(`[ResourceManager] Could not auto-fix ${label}.${evt}: ${e?.message}`);
      }
    }
  }

  if (warnings.length) {
    const tag = autoFix ? " (auto-fix applied where >2× limit)" : "";
    console.warn(`[ResourceManager] Listener leak detected${tag}:\n  ${warnings.join("\n  ")}`);
  }
  return warnings;
}

// ── Clean a single Map by TTL or by size cap ─────────────────────────────────
function cleanMap(map, name, ttlMs, sizeCap) {
  let removed = 0;
  const now = Date.now();

  if (!(map instanceof Map)) return 0;

  // Remove stale entries (entries with a timestamp field older than ttlMs)
  for (const [key, val] of map.entries()) {
    const ts = val?.ts || val?.timestamp || val?.lastSeen || val?.updatedAt;
    if (ts && typeof ts === "number" && now - ts > ttlMs) {
      map.delete(key);
      removed++;
    }
  }

  // If map is still oversized, trim oldest entries (preserve newest)
  if (map.size > sizeCap) {
    const over = map.size - sizeCap;
    let n = 0;
    for (const key of map.keys()) {
      if (n >= over) break;
      map.delete(key);
      n++;
      removed++;
    }
    if (n > 0) {
      console.log(`[ResourceManager] Trimmed ${n} oversized entries from ${name}`);
    }
  }

  return removed;
}

// ── Full cleanup pass ─────────────────────────────────────────────────────────
export function runCleanup(force = false) {
  const mem = process.memoryUsage();
  const heapPct = Math.round((mem.heapUsed / mem.heapTotal) * 100);
  let totalRemoved = 0;

  const underPressure = heapPct >= MEMORY_CLEAN_PCT || force;

  for (const { ref, name, ttlMs } of _trackedCaches) {
    const mapTarget = ref instanceof Map ? ref : (ref?.store instanceof Map ? ref.store : null);
    if (!mapTarget) continue;
    const removed = cleanMap(mapTarget, name, ttlMs, underPressure ? MAX_CACHE_SIZE / 2 : MAX_CACHE_SIZE);
    totalRemoved += removed;
    if (removed > 0) {
      console.log(`[ResourceManager] Cleaned ${removed} stale entries from ${name}`);
    }
  }

  // GC on high heap
  if (heapPct >= MEMORY_WARN_PCT) {
    if (typeof global.gc === "function") {
      global.gc();
      const afterPct = Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100);
      console.log(`[ResourceManager] GC run: heap ${heapPct}% → ${afterPct}%`);
    } else {
      console.warn(`[ResourceManager] High heap ${heapPct}% — add --expose-gc to enable GC`);
    }
  }

  _cleanupStats.runs++;
  _cleanupStats.entriesRemoved += totalRemoved;
  _cleanupStats.lastRun = new Date().toISOString();
  _lastCleanup = Date.now();

  return { heapPct, totalRemoved };
}

// ── Start periodic cleanup ────────────────────────────────────────────────────
export function startResourceManager() {
  if (_cleanupTimer) clearInterval(_cleanupTimer);
  _cleanupTimer = setInterval(() => runCleanup(), CLEANUP_INTERVAL_MS);
  if (_cleanupTimer.unref) _cleanupTimer.unref();
  console.log("[ResourceManager] Started (cleanup every 30 min)");
}

export function stopResourceManager() {
  if (_cleanupTimer) { clearInterval(_cleanupTimer); _cleanupTimer = null; }
}

// ── Memory health snapshot ────────────────────────────────────────────────────
export function getMemoryHealth() {
  const mem   = process.memoryUsage();
  const total = os.totalmem();
  const free  = os.freemem();
  const heapPct = Math.round((mem.heapUsed / mem.heapTotal) * 100);
  const sysPct  = Math.round(((total - free) / total) * 100);
  const status  = heapPct < 70 ? "🟢 Healthy" : heapPct < 85 ? "🟡 Moderate" : "🔴 High";
  return {
    status,
    heapPct,
    sysPct,
    heapUsedMB:  Math.round(mem.heapUsed  / 1048576),
    heapTotalMB: Math.round(mem.heapTotal / 1048576),
    rssMB:       Math.round(mem.rss       / 1048576),
    sysFreeMB:   Math.round(free          / 1048576),
    sysTotalMB:  Math.round(total         / 1048576),
    cleanupStats:      { ..._cleanupStats },
    intervalCount:     _intervalRegistry.size,
    lastCleanup:       _lastCleanup ? new Date(_lastCleanup).toLocaleString() : "never",
  };
}
