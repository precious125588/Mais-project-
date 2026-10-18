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

test("pairing prefers the live WhatsApp Web version and surfaces link events", () => {
  const pairCode = fs.readFileSync(path.join(ROOT, "pair.js"), "utf8");
  const miasCode = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  const uiCode = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

  assert.ok(pairCode.includes("fetchLatestWaWebVersion    = B.fetchLatestWaWebVersion"), "pairing should load the WhatsApp Web version helper");
  assert.ok(pairCode.indexOf("fetchLatestWaWebVersion({})") < pairCode.indexOf("fetchLatestBaileysVersion()"), "pairing should prefer the live WhatsApp Web revision");
  assert.ok(miasCode.indexOf("typeof fetchLatestWaWebVersionRaw === \"function\"") < miasCode.indexOf("typeof fetchLatestBaileysVersionRaw === \"function\""), "the long-lived bot should prefer the same WhatsApp Web revision");
  assert.ok(pairCode.includes("event: 'linked'"), "paired sockets should emit a UI-compatible linked event");
  assert.ok(uiCode.includes("'linking','paired'"), "the pairing UI should subscribe to linking lifecycle events");
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



// Whole launcher evaluated with mocked child processes; never opens WhatsApp.
const { default: vm } = await import('node:vm');
const { EventEmitter } = await import('node:events');
const { createRequire } = await import('node:module');
const realRequire = createRequire(import.meta.url);
function launcherHarness(pairRuntime = null) {
  const children = [], timers = new Set(), statuses = [];
  const fakeProcess = new EventEmitter();
  Object.assign(fakeProcess, { env: { MAX_INSTANCES: '6' }, execPath: process.execPath, stdout: { write() {} }, stderr: { write() {} }, memoryUsage: () => ({ rss: 1 }) });
  const mockRegistry = { updateStatus: (...args) => statuses.push(args) };
  const timeout = (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.add(timer); return timer; };
  const sandbox = {
    __dirname: ROOT, module: { exports: {} }, console: { log() {}, error() {} }, process: fakeProcess,
    setTimeout: timeout, clearTimeout: timer => timers.delete(timer),
    setInterval: () => ({ unref() {} }), Date, Map, Set, Promise,
    require: name => {
      if (name === 'child_process') return { spawn: (...args) => {
        const child = new EventEmitter();
        Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 100 + children.length, exitCode: null, signalCode: null, killed: false,
          kill(signal) { this.killed = true; this.lastSignal = signal; return true; } });
        children.push({ child, args });
        return child;
      } };
      if (name === 'fs') return { existsSync: () => true, readFileSync: () => '', readdirSync: () => [] };
      if (name === './nexstore/sessionRegistry') return mockRegistry;
      if (name === './sessionOwnership') return { handOffToBot() {}, release() {} };
      if (name === './nexstore/adminRequests') return { createWatcher() {} };
      if (name === './sessionPaths') return { sessionDirFor: () => '/test/session', ensureSessionRoot: () => '/test' };
      if (name.startsWith('./')) throw Error('Not loaded in harness: ' + name);
      return realRequire(name);
    },
  };
  sandbox.require.resolve = () => '/mock/pair';
  sandbox.require.cache = pairRuntime ? { '/mock/pair': { exports: pairRuntime } } : {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'mais_launcher.js'), 'utf8'), sandbox);
  return { api: sandbox.module.exports, children, timers, statuses };
}

test('launcher starts more than six distinct users without a count limit', async () => {
  const h = launcherHarness();
  await Promise.all(Array.from({ length: 12 }, (_, i) => h.api.launch(String(123456700 + i), '/test/session')));
  assert.equal(h.children.length, 12);
  assert.equal(h.api.list().filter(r => r.alive).length, 12);
  assert.match(h.children[0].args[1].join(' '), /--max-old-space-size=512/);
});

test('launcher shares one in-flight start for bare number, JID and device JID', async () => {
  const h = launcherHarness();
  const one = h.api.launch('123456789', '/test/session');
  const two = h.api.launch('123456789@s.whatsapp.net', '/test/session');
  const three = h.api.launch('123456789:12@s.whatsapp.net', '/test/session');
  assert.equal(one, two);
  assert.equal(one, three);
  await Promise.all([one, two, three]);
  assert.equal(h.children.length, 1);
});

test('launcher pause cancels a scheduled crash restart', async () => {
  const h = launcherHarness();
  await h.api.launch('123456789', '/test/session');
  const child = h.children[0].child;
  child.exitCode = 1;
  child.emit('exit', 1, null);
  assert.equal([...h.timers].filter(t => t.ms === 8000).length, 1);
  h.api.pause('123456789');
  assert.equal([...h.timers].filter(t => t.ms === 8000).length, 0);
  assert.equal(h.api.isPaused('123456789@s.whatsapp.net'), true);
});

test('launcher does not spawn replacement while old process is still stopping', async () => {
  const h = launcherHarness();
  await h.api.launch('123456789', '/test/session');
  const child = h.children[0].child;
  h.api.stop('123456789');
  const next = h.api.launch('123456789', '/test/session');
  await Promise.resolve();
  assert.equal(h.children.length, 1);
  assert.equal(h.api.list()[0].alive, true, 'signal sent does not mean exited');
  child.signalCode = 'SIGTERM';
  child.emit('exit', null, 'SIGTERM');
  await next;
  assert.equal(h.children.length, 2);
  child.emit('exit', 1, null); // delayed duplicate event must not delete new child
  assert.equal(h.api.list().length, 1);
  assert.equal(h.api.list()[0].pid, h.children[1].child.pid);
});

test('launcher spawn failure is visible and not reported as connected', async () => {
  const h = launcherHarness();
  await h.api.launch('123456789', '/test/session');
  h.children[0].child.emit('error', Object.assign(new Error('spawn failed'), { code: 'EAGAIN' }));
  assert.equal(h.api.list().length, 0);
  assert.match(h.api.lastError('123456789').message, /EAGAIN/);
  assert.equal(h.statuses.some(([, state]) => state === 'connected'), false);
});

test('launcher waits for companion socket retirement before spawning', async () => {
  let pairingLive = true;
  const h = launcherHarness({ isSessionLive: () => pairingLive });
  const starting = h.api.launch('123456789', '/test/session');
  await Promise.resolve();
  assert.equal(h.children.length, 0);
  const poll = [...h.timers].find(t => t.ms === 250);
  assert.ok(poll, 'waits instead of stealing the pairing socket');
  pairingLive = false;
  poll.fn();
  await new Promise(resolve => setImmediate(resolve));
  const settle = [...h.timers].find(t => t.ms === 3000);
  assert.ok(settle, 'retired socket receives a settling interval');
  settle.fn();
  await starting;
  assert.equal(h.children.length, 1);
});

test('pairing API resumes an offline saved session without deleting credentials', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/pair',");
  const end = source.indexOf("app.get(", start);
  let handler, launched = 0, deleted = 0, response;
  const sandbox = {
    app: { post: (route, middleware, fn) => { handler = fn; } }, rateLimit: () => () => {},
    _pair: { hasPairedSession: () => true, isSessionLive: () => false, unpairSession: () => { deleted++; } },
    _launcher: { list: () => [], isPaused: () => false, launch: async () => { launched++; } },
    _sessionPaths: { sessionDirFor: () => '/saved/session' },
    Date, console,
  };
  vm.runInNewContext(source.slice(start, end), sandbox);
  const res = { status() { return this; }, json(body) { response = body; return body; } };
  await handler({ body: { number: '123456789' } }, res);
  assert.equal(response.ok, true);
  assert.equal(response.restored, true);
  assert.equal(launched, 1);
  assert.equal(deleted, 0);
});

test('pairing UI subscribes to startup failures and bounds linked startup waiting', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.match(ui, /'bot_error'/);
  assert.match(ui, /case 'bot_error':\s*fail\(/);
  assert.match(ui, /s\.health\?\.phase === 'start_failed'/);
  assert.match(ui, /stage === 'linked' && waited > 240000/);
});
