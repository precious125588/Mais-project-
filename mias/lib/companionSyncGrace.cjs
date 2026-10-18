'use strict';

const MIN_COMPANION_SYNC_MS = 15_000;
const MAX_COMPANION_SYNC_MS = 25_000;
const SAVE_INTERVAL_MS = 1_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function duration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/**
 * Keep the temporary pairing socket alive while WhatsApp finishes syncing the
 * newly linked companion keys. History can arrive early or not at all, so
 * always keep a 15-second floor and use a 25-second hard ceiling.
 */
async function waitForCompanionSync({
  eventEmitter,
  saveCreds,
  minMs = MIN_COMPANION_SYNC_MS,
  maxMs = MAX_COMPANION_SYNC_MS,
  sleepFn = sleep,
} = {}) {
  const minimum = duration(minMs, MIN_COMPANION_SYNC_MS);
  const maximum = Math.max(minimum, duration(maxMs, MAX_COMPANION_SYNC_MS));
  let historyReceived = false;
  let elapsedMs = 0;
  const onHistory = () => { historyReceived = true; };

  eventEmitter?.once?.('messaging-history.set', onHistory);

  const saveSafely = async () => {
    try {
      await saveCreds?.();
    } catch {
      // A failed snapshot must not interrupt WhatsApp's pairing handoff.
    }
  };

  try {
    await saveSafely();
    while (elapsedMs < maximum && (elapsedMs < minimum || !historyReceived)) {
      const interval = Math.min(SAVE_INTERVAL_MS, maximum - elapsedMs);
      await sleepFn(interval);
      elapsedMs += interval;
      await saveSafely();
    }

    return { elapsedMs, historyReceived };
  } finally {
    if (typeof eventEmitter?.off === 'function') {
      eventEmitter.off('messaging-history.set', onHistory);
    } else {
      eventEmitter?.removeListener?.('messaging-history.set', onHistory);
    }
  }
}

module.exports = {
  MIN_COMPANION_SYNC_MS,
  MAX_COMPANION_SYNC_MS,
  waitForCompanionSync,
};
