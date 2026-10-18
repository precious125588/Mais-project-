import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  MIN_COMPANION_SYNC_MS,
  MAX_COMPANION_SYNC_MS,
  waitForCompanionSync,
} = require("../mias/lib/companionSyncGrace.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fakeSync(historyAtMs) {
  const eventEmitter = new EventEmitter();
  let elapsed = 0;
  let saves = 0;
  let emitted = false;

  const promise = waitForCompanionSync({
    eventEmitter,
    minMs: MIN_COMPANION_SYNC_MS,
    maxMs: MAX_COMPANION_SYNC_MS,
    saveCreds: async () => { saves += 1; },
    sleepFn: async (ms) => {
      elapsed += ms;
      if (!emitted && historyAtMs !== null && elapsed >= historyAtMs) {
        emitted = true;
        eventEmitter.emit("messaging-history.set");
      }
    },
  });

  return { promise, eventEmitter, getElapsed: () => elapsed, getSaves: () => saves };
}

test("early companion history still gets the full minimum sync window", async () => {
  const run = fakeSync(4_000);
  const result = await run.promise;

  assert.equal(result.historyReceived, true);
  assert.equal(result.elapsedMs, MIN_COMPANION_SYNC_MS);
  assert.equal(run.getElapsed(), MIN_COMPANION_SYNC_MS);
  assert.equal(run.getSaves(), MIN_COMPANION_SYNC_MS / 1_000 + 1);
  assert.equal(run.eventEmitter.listenerCount("messaging-history.set"), 0);
});

test("late companion history extends the wait, but never beyond the hard ceiling", async () => {
  const run = fakeSync(18_000);
  const result = await run.promise;

  assert.equal(result.historyReceived, true);
  assert.ok(result.elapsedMs >= 18_000);
  assert.ok(result.elapsedMs < MAX_COMPANION_SYNC_MS);
  assert.equal(run.getElapsed(), result.elapsedMs);
  assert.equal(run.eventEmitter.listenerCount("messaging-history.set"), 0);
});

test("missing history still releases the pairing socket at the bounded maximum", async () => {
  const run = fakeSync(null);
  const result = await run.promise;

  assert.equal(result.historyReceived, false);
  assert.equal(result.elapsedMs, MAX_COMPANION_SYNC_MS);
  assert.equal(run.getElapsed(), MAX_COMPANION_SYNC_MS);
  assert.equal(run.eventEmitter.listenerCount("messaging-history.set"), 0);
});

test("pairing waits for companion sync before retiring the socket for handoff", () => {
  const source = fs.readFileSync(path.join(ROOT, "pair.js"), "utf8");
  const syncAt = source.indexOf("await waitForCompanionSync({");
  const retireAt = source.indexOf("retireSocket(nexusDevNumber, 'handoff to MIAS MDX')");

  assert.ok(syncAt >= 0, "pairing handoff must await the bounded companion-sync helper");
  assert.ok(retireAt > syncAt, "pairing socket must remain open through the companion-sync wait");
});
