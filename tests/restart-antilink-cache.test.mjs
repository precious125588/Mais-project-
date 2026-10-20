import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(ROOT, "mias", "index.js"), "utf8");

test("Anti-Link deletes and warns with the existing link-type identifier", async () => {
  const start = source.indexOf("async function applyGuardAction(");
  const end = source.indexOf("\n}\n\n// ═", start);
  assert.ok(start >= 0 && end > start, "production guard helper is present");

  const sent = [];
  const sandbox = {
    resolveLid: value => value,
    isBotGroupAdmin: async () => true,
    warns: new Map(),
    parseDurationMs: () => 1000,
    setTimeout,
  };
  vm.runInNewContext(source.slice(start, end + 2), sandbox);
  const sock = {
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
    },
  };
  const messageKey = { id: "link-message" };

  await sandbox.applyGuardAction(
    sock,
    "120363000000000000@g.us",
    "2348000000000@s.whatsapp.net",
    messageKey,
    "delete",
    "Anti-Link",
    "TikTok",
  );

  assert.equal(sent.length, 2, "the guard should delete then post its warning");
  assert.equal(sent[0].content.delete, messageKey);
  assert.match(sent[1].content.text, /Type: \*TikTok\*/);
  assert.match(sent[1].content.text, /Anti-Link triggered/);
  assert.deepEqual([...sent[1].content.mentions], ["2348000000000@s.whatsapp.net"]);
});

test("restart acknowledges exactly, flushes, and passes only the intentional code-75 exit", async () => {
  const guardStart = source.indexOf("try {\n  const _origProcessExit");
  const guardEnd = source.indexOf("// ── CRASH GUARD", guardStart);
  const restartStart = source.indexOf('cmd("restart",');
  const restartEnd = source.indexOf('\ncmd(["setprefix"', restartStart);
  assert.ok(guardStart >= 0 && guardEnd > guardStart, "process exit guard is present");
  assert.ok(restartStart >= 0 && restartEnd > restartStart, "restart command is present");

  const events = [];
  const realExits = [];
  let restartTimer = null;
  let restartDelay = 0;
  let restartHandler = null;
  const sandbox = {
    process: {
      exit: code => realExits.push(code),
    },
    console: {
      error: (...args) => events.push({ type: "log", args }),
    },
    fs: {
      writeFileSync: (file, data) => events.push({ type: "marker", file, data }),
    },
    path,
    AUTH_DIR: "/sessions/account-a",
    saveGuardDb: () => events.push({ type: "guard-save" }),
    _ownerRecord: () => ({}),
    __saveNowImmediate: async () => events.push({ type: "save" }),
    flushPersistence: async () => {
      events.push({ type: "flush" });
      return true;
    },
    sendReply: async (_sock, _msg, text) => events.push({ type: "reply", text }),
    setTimeout: (callback, ms) => {
      restartTimer = callback;
      restartDelay = ms;
      return {};
    },
    cmd: (name, _options, handler) => {
      if (name === "restart") restartHandler = handler;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(guardStart, guardEnd), sandbox);
  vm.runInContext(source.slice(restartStart, restartEnd), sandbox);

  // An accidental code 75 is still guarded; the manual command opts in only
  // at the moment it is ready to exit.
  sandbox.process.exit(75);
  assert.deepEqual(realExits, []);

  await restartHandler({}, { key: { remoteJid: "2348000000000@s.whatsapp.net" } });
  assert.equal(events.find(event => event.type === "reply")?.text, "RESTARTING......");
  assert.ok(events.some(event => event.type === "save"));
  assert.ok(events.some(event => event.type === "flush"));
  assert.equal(events.find(event => event.type === "marker")?.file, "/sessions/account-a/.last_alive_notice.json");
  assert.equal(restartDelay, 2500);

  restartTimer();
  assert.deepEqual(realExits, [75], "the launcher receives the one-session restart signal");
});

test("launcher handles restart code 75 for the selected account only", () => {
  const launcher = fs.readFileSync(path.join(ROOT, "mais_launcher.js"), "utf8");
  assert.match(launcher, /proc\.on\('exit', \(code, sig\) =>/);
  assert.match(launcher, /running\.delete\(number\)/);
  assert.match(launcher, /const delay = code === 75 \? 3000 : _backoffMs\(newCt\)/);
  assert.match(launcher, /await launch\(number, sessionDir, r\?\.envOverrides \|\| envOverrides\)/);
});

test("the five-minute cleaner clears transient caches and preserves account state", () => {
  const start = source.indexOf("const CACHE_CLEAN_MS =");
  const logAt = source.indexOf("console.log(`⏱️", start);
  const end = source.indexOf("\n// ", logAt);
  assert.ok(start >= 0 && logAt > start && end > logAt, "production cache cleaner is present");

  let callback;
  let intervalMs = 0;
  let wasUnrefed = false;
  const processedMessages = new Set(["processed"]);
  const adultResults = new Set(["adult-result"]);
  const retryStore = new Map([["retry", 1]]);
  const pushNameCache = new Map([["2348000000000", "Known Contact"]]);
  const settings = new Map([["owner", { antiLink: true }]]);
  const authSession = { creds: "preserved" };
  const sandbox = {
    processedMessages,
    _lastAdultResults: adultResults,
    _msgRetryStore: retryStore,
    pushNameCache,
    process: { memoryUsage: () => ({ rss: 64 * 1024 * 1024 }) },
    console: { log: () => {} },
    setInterval: (fn, ms) => {
      callback = fn;
      intervalMs = ms;
      return { unref: () => { wasUnrefed = true; } };
    },
  };
  const intervalCode = source.slice(start, end);
  const interval = vm.runInNewContext(`${intervalCode}\nCACHE_CLEAN_MS;`, sandbox);

  assert.equal(interval, 5 * 60 * 1000);
  assert.equal(intervalMs, 5 * 60 * 1000);
  assert.equal(wasUnrefed, true);
  callback();
  assert.equal(processedMessages.size, 0);
  assert.equal(adultResults.size, 0);
  assert.equal(retryStore.get("retry"), 1);
  assert.equal(pushNameCache.get("2348000000000"), "Known Contact");
  assert.equal(settings.get("owner").antiLink, true);
  assert.equal(authSession.creds, "preserved");
});
