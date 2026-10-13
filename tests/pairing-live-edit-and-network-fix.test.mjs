import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

test("pair.js contains weak network resilience configuration", () => {
  const pairCode = fs.readFileSync(path.join(ROOT, "pair.js"), "utf8");

  // Socket timeout extensions for weak network
  assert.ok(pairCode.includes("connectTimeoutMs: 90000"), "connectTimeoutMs should be 90000ms");
  assert.ok(pairCode.includes("defaultQueryTimeoutMs: 60000"), "defaultQueryTimeoutMs should be 60000ms");
  assert.ok(pairCode.includes("keepAliveIntervalMs: 30000"), "keepAliveIntervalMs should be 30000ms");
  assert.ok(pairCode.includes("retryRequestDelayMs: 2500"), "retryRequestDelayMs should be present");

  // waitForSocketOpen extended timeout
  assert.ok(pairCode.includes("waitForSocketOpen(sock, timeoutMs = 35000)"), "default timeout for waitForSocketOpen should be 35000ms");
  assert.ok(pairCode.includes("waitForSocketOpen(nexus, 35000)"), "startpairing should wait 35000ms for socket open");
});

test("pair.js fixes 515 restart loop and emits linking/paired events", () => {
  const pairCode = fs.readFileSync(path.join(ROOT, "pair.js"), "utf8");

  // 515 restart guard
  assert.ok(pairCode.includes("!isRestarting515"), "code request guard must check !isRestarting515");
  assert.ok(pairCode.includes("tracker.isLinking = true"), "isLinking must be set during linking");

  // Lifecycle events on pairEvents
  assert.ok(pairCode.includes("event: 'code_ready'"), "must emit code_ready event");
  assert.ok(pairCode.includes("event: 'linking'"), "must emit linking event");
  assert.ok(pairCode.includes("event: 'paired'"), "must emit paired event");
  assert.ok(pairCode.includes("event: 'timeout'"), "must emit timeout event");
  assert.ok(pairCode.includes("event: 'failed'"), "must emit failed event");

  // Runtime state exposes linking
  assert.ok(pairCode.includes("isLinking: !!tracker?.isLinking"), "getPairingRuntimeState must expose isLinking");
});

test("case.js implements live edited text state transitions for .pair", () => {
  const caseCode = fs.readFileSync(path.join(ROOT, "case.js"), "utf8");

  // Extract case 'pair' block
  const startIdx = caseCode.indexOf("case 'pair':");
  const endIdx = caseCode.indexOf("case '__dup_removed_codeai__':");
  assert.ok(startIdx !== -1 && endIdx !== -1, "case 'pair' block must exist");

  const pairCmdBlock = caseCode.slice(startIdx, endIdx);

  // Live edited text requirements
  assert.ok(pairCmdBlock.includes("edit: liveKey"), "must use message edit on liveKey");
  assert.ok(pairCmdBlock.includes("Request code for ${rawDigits}"), "must start with 'Request code for <number>'");
  assert.ok(pairCmdBlock.includes("await editLive(formattedCode)"), "must edit to the pairing code when received");
  assert.ok(pairCmdBlock.includes("await editLive('linking device')"), "must edit to 'linking device' when linking starts");
  assert.ok(pairCmdBlock.includes("await editLive('bot alive')"), "must edit to 'bot alive' when linking completes");
  assert.ok(pairCmdBlock.includes("await editLive('code timeout')"), "must edit to 'code timeout' if linking expires");
  assert.ok(pairCmdBlock.includes("await editLive(`debug:"), "must edit to debug text on error");

  // Clean output: no long redundant manual instructions
  assert.ok(!pairCmdBlock.includes("Tap *Settings* (or three dots ⋮)"), "must not dump multi-step text");
});

test("pair.js exports event emitter and runtime state query", async () => {
  const pairModule = await import("../pair.js");
  const mod = pairModule.default || pairModule;

  assert.ok(mod.pairEvents, "pairEvents must be exported");
  assert.equal(typeof mod.pairEvents.on, "function", "pairEvents must be an EventEmitter");
  assert.equal(typeof mod.getPairingRuntimeState, "function", "getPairingRuntimeState must be a function");
  assert.equal(typeof mod.waitForPairingResult, "function", "waitForPairingResult must be a function");
  assert.equal(typeof mod.startpairing, "function", "startpairing must be a function");
});
