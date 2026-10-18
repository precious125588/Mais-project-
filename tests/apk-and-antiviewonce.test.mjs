import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const idxSrc = fs.readFileSync(path.join(ROOT, 'mias', 'index.js'), 'utf8');

test('Anti-ViewOnce: default settings include antiViewOnce: false and antiViewOnceMode: "private"', () => {
  assert.match(idxSrc, /antiViewOnce:\s*false/);
  assert.match(idxSrc, /antiViewOnceMode:\s*["']private["']/);
});

test('Anti-ViewOnce: Settings menu includes sections 39 and 40', () => {
  assert.match(idxSrc, /Anti ViewOnce/);
  assert.match(idxSrc, /39\.1\s+ᴇɴᴀʙʟᴇ/);
  assert.match(idxSrc, /39\.2\s+ᴅɪsᴀʙʟᴇ/);
  assert.match(idxSrc, /Anti ViewOnce Mode/);
  assert.match(idxSrc, /40\.1\s+ᴄʜᴀᴛ/);
  assert.match(idxSrc, /40\.2\s+ᴘʀɪᴠᴀᴛᴇ/);
});

test('Anti-ViewOnce: SETTINGS_MAP handles 39.1, 39.2, 40.1, 40.2 toggles', () => {
  assert.match(idxSrc, /"39\.1":\s*s\s*=>\s*\{[^}]*s\.antiViewOnce\s*=\s*true/);
  assert.match(idxSrc, /"39\.2":\s*s\s*=>\s*\{[^}]*s\.antiViewOnce\s*=\s*false/);
  assert.match(idxSrc, /"40\.1":\s*s\s*=>\s*\{[^}]*s\.antiViewOnceMode\s*=\s*"chat"/);
  assert.match(idxSrc, /"40\.2":\s*s\s*=>\s*\{[^}]*s\.antiViewOnceMode\s*=\s*"private"/);
});

test('Anti-ViewOnce: handleSettingsNumericReply button maps include antiviewonce and vomode', () => {
  assert.match(idxSrc, /antiviewonce:\s*\["39\.1",\s*"39\.2"\]/);
  assert.match(idxSrc, /antiviewoncemode:\s*\["40\.1",\s*"40\.2"\]/);
});

test('Anti-ViewOnce: handleViewOnce function exists and implements unwrap and delivery', () => {
  assert.match(idxSrc, /async function handleViewOnce\(sock,\s*msg\)\s*\{/);
  assert.match(idxSrc, /msg\.__voHandled\s*=\s*true/);
  assert.match(idxSrc, /downloadStoredMediaBuffer/);
  assert.match(idxSrc, /isChatMode\s*\?\s*remoteJid\s*:\s*ownerJid/);
});

test('Anti-ViewOnce: .antivo command supports on, off, chat, private and displays clean status', () => {
  assert.match(idxSrc, /cmd\(\["antivo",\s*"antiviewonce"/);
  assert.match(idxSrc, /ownerS\.antiViewOnceMode\s*=\s*"chat"/);
  assert.match(idxSrc, /ownerS\.antiViewOnceMode\s*=\s*"private"/);
  assert.match(idxSrc, /Anti-ViewOnce Mode: CHAT/);
  assert.match(idxSrc, /Anti-ViewOnce Mode: PRIVATE/);
});

test('APK: command uses 🌀 for start, ✅ for success, and ❌ for failure with clear message', () => {
  const apkStart = idxSrc.indexOf('cmd(["apk", "apkdl"');
  assert.ok(apkStart > 0, 'APK command registered');
  const apkNextCmd = idxSrc.indexOf('\ncmd([', apkStart + 20);
  const apkBlock = idxSrc.slice(apkStart, apkNextCmd > 0 ? apkNextCmd : apkStart + 8000);

  // Reaction checks
  assert.match(apkBlock, /await\s+react\(sock,\s*msg,\s*["']🌀["']\)/);
  assert.match(apkBlock, /await\s+react\(sock,\s*msg,\s*["']✅["']\)/);
  assert.match(apkBlock, /await\s+react\(sock,\s*msg,\s*["']❌["']\)/);

  // Clear failure message
  assert.match(apkBlock, /APK Download Failed/);

  // Prexzy, NexRay, and fallback providers
  assert.match(apkBlock, /prexzyGet/);
  assert.match(apkBlock, /nx\?\.search\?\.apkpure/);
  assert.match(apkBlock, /nx\?\.downloader\?\.playstore/);
  assert.match(apkBlock, /zeroGet/);

  // Temp file on disk and immediate cleanup
  assert.match(apkBlock, /mkdtemp/);
  assert.match(apkBlock, /createWriteStream/);
  assert.match(apkBlock, /rm\(tmpDir,\s*\{[^}]*recursive:\s*true/);
});


// Execute the downloader helpers and the actual registered APK handler without
// importing the live socket entrypoint.
const { createRequire } = await import('node:module');
const { default: vm } = await import('node:vm');
const os = await import('node:os');
const requireForApk = createRequire(new URL('../mias/index.js', import.meta.url));
const dlHelpers = requireForApk('../lib/reliableDl.js');

test('APK resolver waits for usable success rather than first failure and cancels losers', async () => {
  let slowSignal;
  const result = await dlHelpers.firstUsableResult([
    async () => null,
    async signal => { slowSignal = signal; return new Promise(() => {}); },
    async () => ({ dl: 'https://example.test/app.apk', name: 'test' }),
  ], { timeoutMs: 100 });
  assert.equal(result.name, 'test');
  assert.equal(slowSignal.aborted, true);
});

test('APK stalled SDK/provider returns a bounded terminal result', async () => {
  const at = Date.now();
  assert.equal(await dlHelpers.firstUsableResult([() => new Promise(() => {})], { timeoutMs: 25 }), null);
  assert.ok(Date.now() - at < 1000);
  await assert.rejects(dlHelpers.withDeadline(() => { throw Error('sync'); }, 100), /sync/);
});

test('APK stream accepts ZIP bytes and rejects HTML, invalid ZIP, oversized and truncated bodies', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-validation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const apk = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(2048)]);
  const fetchOf = (body, type = 'application/octet-stream') => async () => new Response(body, { headers: { 'content-type': type } });
  const target = path.join(dir, 'app.apk');
  const bytes = await dlHelpers.downloadApkToFile('https://example.test/app.apk', target, { fetchImpl: fetchOf(apk) });
  assert.equal(bytes, apk.length);
  assert.deepEqual(fs.readFileSync(target), apk);
  await assert.rejects(dlHelpers.downloadApkToFile('https://example.test/a', target, { fetchImpl: fetchOf('<html>error</html>', 'text/html') }), /APK_NOT_BINARY/);
  await assert.rejects(dlHelpers.downloadApkToFile('https://example.test/a', target, { fetchImpl: fetchOf(Buffer.alloc(2048)) }), /APK_INVALID_ZIP/);
  await assert.rejects(dlHelpers.downloadApkToFile('https://example.test/a', target, { fetchImpl: fetchOf(apk), maxBytes: 1024 }), /APK_TOO_LARGE/);
  await assert.rejects(dlHelpers.downloadApkToFile('https://example.test/a', target, { fetchImpl: fetchOf(apk.subarray(0, 10)) }), /APK_EMPTY_OR_TRUNCATED/);
});

test('APK deadline aborts a body that never finishes streaming', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-stall-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0x50, 0x4b, 3, 4])); }, cancel() { cancelled = true; } });
  await assert.rejects(dlHelpers.downloadApkToFile('https://example.test/a', path.join(dir, 'stall.apk'), {
    timeoutMs: 30, fetchImpl: async () => new Response(body),
  }), error => error.name === 'AbortError');
  assert.equal(cancelled, true);
});

test('actual APK handler delivers a document through a working fallback and removes temporary files', async () => {
  const start = idxSrc.indexOf('cmd(["apk", "apkdl"');
  const end = idxSrc.indexOf('\ncmd("radio"', start);
  let handler;
  const replies = [], reactions = [], files = [];
  const sandbox = {
    cmd: (names, options, fn) => { handler = fn; },
    CONFIG: { PREFIX: '.', BOT_NAME: 'test' },
    require: name => name === '../lib/reliableDl.js' ? {
      ...dlHelpers,
      downloadApkToFile: async (url, file) => { files.push(file); fs.writeFileSync(file, Buffer.alloc(2048)); return 2048; },
    } : requireForApk(name),
    nx: { search: { apkpure: async () => ({ result: { download: 'https://example.test/test.apk', name: 'test' } }) } },
    axios: { get: async () => { throw Error('offline'); }, head: async () => ({ headers: {} }) },
    prexzyGet: async () => ({ ok: false }), zeroGet: async () => null, toxicCall: async () => null,
    react: async (sock, msg, emoji) => { reactions.push(emoji); },
    editMessage: async (sock, jid, key, text) => { replies.push(text); },
    sendReply: async () => {}, sendCTAButtons: async () => {}, withJustXFooter: text => text,
    Date, Buffer, Promise, URL, AbortController, console,
  };
  vm.runInNewContext(idxSrc.slice(start, end), sandbox);
  const sent = [];
  await handler({ sendMessage: async (jid, content) => { sent.push(content); return { key: { id: 'status' } }; } }, { key: { remoteJid: '123@s.whatsapp.net' } }, ['test']);
  assert.equal(sent.filter(m => m.document).length, 1);
  assert.ok(reactions.includes('✅'));
  assert.equal(replies.some(s => /downloaded and sent successfully/.test(s)), true);
  assert.equal(files.length, 1);
  assert.equal(fs.existsSync(path.dirname(files[0])), false);
});

test('silent archive denies non-owners without chat spam and ignores ordinary media', async () => {
  const start = idxSrc.indexOf('cmd(["vv2","lol"');
  const end = idxSrc.indexOf('\ncmd("note"', start);
  let handler, options;
  const sandbox = {
    cmd: (names, opts, fn) => { options = opts; handler = fn; },
    getContextInfo: msg => msg.context,
    CONFIG: {}, Buffer, console,
  };
  vm.runInNewContext(idxSrc.slice(start, end), sandbox);
  assert.equal(options.ownerOnly, true);
  assert.equal(options.silent, true);
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  await handler(sock, { key: {}, context: undefined });
  await handler(sock, { key: {}, context: { quotedMessage: { imageMessage: { url: 'ordinary' } } } });
  assert.equal(sent.length, 0);
  const gateStart = idxSrc.indexOf('            if (entry.ownerOnly && !fromOwner && !adminAllowed)');
  const gateEnd = idxSrc.indexOf('            if (entry.adminOnly', gateStart);
  const gate = vm.runInNewContext('(async function(entry, silentArchive) {' + idxSrc.slice(gateStart, gateEnd) + '})', {
    fromOwner: false, adminAllowed: false, sock, msg: {}, sendReply: async (...args) => sent.push(args),
  });
  await gate({ ownerOnly: true }, true);
  assert.equal(sent.length, 0);
  await gate({ ownerOnly: true }, false);
  assert.equal(sent.length, 1, 'ordinary protected commands retain permission feedback');
});
