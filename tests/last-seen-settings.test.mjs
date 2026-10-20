import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'mias/index.js'), 'utf8');
const require = createRequire(import.meta.url);
const lastSeen = require('../mias/features/lastSeen.cjs');

function productionMap() {
  const start = source.indexOf('const SETTINGS_MAP = globalThis.SETTINGS_MAP = {');
  const end = source.indexOf('\n};', start) + 3;
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(source.slice(start, end) + '\nSETTINGS_MAP;', {
    setWorkModeState: (s, mode) => { s.workMode = mode; },
    getSettings: () => ({}),
    require,
  });
}

function productionParser(map, state) {
  const handlerStart = source.lastIndexOf('handleSettingsNumericReply = async function (sock, msg, body) {');
  const handlerEnd = source.indexOf('\n  // ══ 10. CHATBOT COMMAND', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const replies = [];
  const settingsSession = new Map();
  const sandbox = {
    __v31Unwrap: value => value,
    __miasHasPendingPicker: () => false,
    __ttGetSelection: () => null,
    settingsSession,
    SETTINGS_MAP: map,
    CONFIG: { OWNER_NUMBER: '123456789', PREFIX: '.' },
    getSettings: () => state,
    getSender: msg => msg?.sender || msg?.key?.participant || msg?.key?.remoteJid || '',
    isOwner: sender => String(sender).startsWith('123456789'), isCreator: () => false,
    isSudo: () => false, isGroupAdmin: async () => false, resolveLid: x => x,
    saveNow: () => {}, saveGuardDb: () => true, persistLastSeenState: async () => true, sendReply: async (_s, _m, text) => replies.push(text),
    Date, setTimeout: () => 0,
  };
  vm.runInNewContext(source.slice(handlerStart, handlerEnd), sandbox);
  return { handler: sandbox.handleSettingsNumericReply, replies, settingsSession };
}

test('1. Menu integration: Sections 36/37 appear after 35 and before Anti ViewOnce, with persisted-state checkmarks', () => {
  const menuStart = source.indexOf('function buildSettingsMenu(');
  const mapStart = source.indexOf('const SETTINGS_MAP = globalThis.SETTINGS_MAP = {');
  const menu = source.slice(menuStart, mapStart);
  const section36 = menu.indexOf('*𝗟𝗮𝘀𝘁 𝗦𝗲𝗲𝗻*');
  const section37 = menu.indexOf('*𝗙𝗿𝗲𝗲𝘇𝗲 𝗟𝗮𝘀𝘁 𝗦𝗲𝗲𝗻*');
  const anti = menu.indexOf('*Anti ViewOnce*');
  assert.ok(section36 >= 0 && section37 > section36 && anti > section37);
  assert.match(menu, /36\.1 ᴇɴᴀʙʟᴇ\s+\$\{s\.lastSeenEnabled \? "✅" : ""\}/);
  assert.match(menu, /37\.1 ꜰʀᴇᴇᴢᴇ\s+\$\{s\.lastSeenFrozen \? "✅" : ""\}/);
});

test('2. Numbered replies: all four menu choices reach their intended production handlers', async () => {
  const state = { lastSeenEnabled: false, lastSeenFrozen: false, lastSeenRecords: {} };
  const { handler, settingsSession } = productionParser(productionMap(), state);
  const jid = '123456789@s.whatsapp.net';
  for (const [choice, expected] of [['36.1', true], ['36.2', false], ['37.1', true], ['37.2', false]]) {
    settingsSession.set(jid, { sender: jid, ts: Date.now() });
    const msg = { key: { remoteJid: jid }, message: { conversation: choice, extendedTextMessage: { contextInfo: { quotedMessage: { conversation: '⚙️ SETTINGS Last Seen Freeze Last Seen' } } } } };
    assert.equal(await handler({}, msg, choice), true, choice);
    if (choice.startsWith('36')) assert.equal(state.lastSeenEnabled, expected, choice);
    else assert.equal(state.lastSeenFrozen, expected, choice);
  }
});

test('3. Enable tracking: reliable observed online events save an explicitly typed timestamp', async () => {
  const records = {};
  const out = lastSeen.applyPresenceObservation(records, '15551234567@s.whatsapp.net', { lastKnownPresence: 'available' }, { enabled: true, now: 1_700_000_000_000 });
  assert.equal(out.updated, true);
  assert.deepEqual(out.records['15551234567@s.whatsapp.net'], { timestamp: 1_700_000_000_000, kind: 'observed_online', frozen: false });
  const server = lastSeen.applyPresenceObservation(out.records, '15551234568@s.whatsapp.net', { lastSeen: 1_699_999_999 }, { enabled: true, now: 1_700_000_000_000 });
  assert.equal(server.records['15551234568@s.whatsapp.net'].kind, 'server_last_seen');
  assert.equal(server.records['15551234568@s.whatsapp.net'].timestamp, 1_699_999_999_000);
});

test('4. Disable tracking prevents listener writes and saved timestamp changes', async () => {
  const ev = new EventEmitter();
  const saved = [];
  const owner = { lastSeenEnabled: false, lastSeenFrozen: false, lastSeenRecords: {} };
  const sock = { ev, user: { id: '15550000000:5@s.whatsapp.net' } };
  assert.equal(lastSeen.installLastSeenListener(sock, { getOwnerSettings: () => owner, persist: async x => { saved.push(x); return true; }, now: () => 1000 }), true);
  ev.emit('presence.update', { presences: { '15551234567@s.whatsapp.net': { lastKnownPresence: 'available' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(owner.lastSeenRecords, {});
  assert.equal(saved.length, 0);
});

test('5. Freeze: new observation cannot overwrite an already frozen per-user timestamp', () => {
  const frozen = lastSeen.setFrozen({ '15551234567@s.whatsapp.net': { timestamp: 1000, kind: 'observed_online' } }, true);
  const out = lastSeen.applyPresenceObservation(frozen, '15551234567@s.whatsapp.net', { lastKnownPresence: 'available' }, { enabled: true, frozen: true, now: 2000 });
  assert.equal(out.updated, false);
  assert.equal(out.records['15551234567@s.whatsapp.net'].timestamp, 1000);
  assert.equal(out.records['15551234567@s.whatsapp.net'].frozen, true);
});

test('6. Unfreeze: next valid observation advances the saved timestamp', () => {
  const unfrozen = lastSeen.setFrozen({ '15551234567@s.whatsapp.net': { timestamp: 1000, kind: 'observed_online' } }, false);
  const out = lastSeen.applyPresenceObservation(unfrozen, '15551234567@s.whatsapp.net', { lastKnownPresence: 'available' }, { enabled: true, frozen: false, now: 2000 });
  assert.equal(out.updated, true);
  assert.equal(out.records['15551234567@s.whatsapp.net'].timestamp, 2000);
  assert.equal(out.records['15551234567@s.whatsapp.net'].frozen, false);
});

test('7. Persistence/restart: guard JSON atomically retains state and unrelated keys across processes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mias-last-seen-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'database', 'guard_settings.json');
  const owner = { lastSeenEnabled: true, lastSeenFrozen: true, lastSeenRecords: { '15551234567@s.whatsapp.net': { timestamp: 1234, kind: 'server_last_seen', frozen: true } } };
  assert.equal(lastSeen.persistGuardSettingsJson(file, owner, ['lastSeenEnabled', 'lastSeenFrozen', 'lastSeenRecords'], { __autoreact_off_v1: true }), true);
  let parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  parsed.keepMe = 'untouched';
  fs.writeFileSync(file, JSON.stringify(parsed));
  // This exercises the established JSON settings path directly, as used when
  // the optional primary Neon backend is not configured for this bot.
  const result = lastSeen.persistGuardSettingsJson(file, owner, ['lastSeenEnabled', 'lastSeenFrozen', 'lastSeenRecords'], { __autoreact_off_v1: true });
  assert.equal(result, true);
  const reload = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(reload.keepMe, 'untouched');
  assert.equal(reload.lastSeenEnabled, true);
  assert.equal(reload.lastSeenFrozen, true);
  assert.equal(reload.lastSeenRecords['15551234567@s.whatsapp.net'].timestamp, 1234);
  const child = spawnSync(process.execPath, ['-e', `const s=require(${JSON.stringify(path.join(ROOT, 'mias/features/lastSeen.cjs'))}); const x=JSON.parse(require('fs').readFileSync(${JSON.stringify(file)},'utf8')); if(!x.lastSeenEnabled||!x.lastSeenFrozen||x.lastSeenRecords['15551234567@s.whatsapp.net'].timestamp!==1234)process.exit(1);`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('8. User isolation: freeze and timestamps remain independent by user JID', () => {
  const records = {
    '15551234567@s.whatsapp.net': { timestamp: 1000, kind: 'observed_online', frozen: true },
    '15551234568@s.whatsapp.net': { timestamp: 1100, kind: 'observed_online', frozen: false },
  };
  const out = lastSeen.applyPresenceObservation(records, '15551234568@s.whatsapp.net', { lastKnownPresence: 'available' }, { enabled: true, frozen: false, now: 2000 });
  assert.equal(out.records['15551234567@s.whatsapp.net'].timestamp, 1000);
  assert.equal(out.records['15551234567@s.whatsapp.net'].frozen, true);
  assert.equal(out.records['15551234568@s.whatsapp.net'].timestamp, 2000);
});

test('9. Error handling: unavailable timestamps are ignored; JSON write errors do not report success', async () => {
  const missing = lastSeen.applyPresenceObservation({}, '15551234567@s.whatsapp.net', { lastKnownPresence: 'unavailable' }, { enabled: true, now: 9999 });
  assert.equal(missing.updated, false);
  assert.equal(missing.reason, 'unobserved');
  assert.equal(lastSeen.validTimestamp(Infinity), null);
  assert.equal(lastSeen.validTimestamp(9999999999999999), null);
  assert.equal(lastSeen.persistGuardSettingsJson('/proc/mias-no-write/guard_settings.json', { lastSeenEnabled: true }, ['lastSeenEnabled']), false);
  const ev = new EventEmitter();
  const owner = { lastSeenEnabled: true, lastSeenFrozen: false, lastSeenRecords: {} };
  const sock = { ev, user: { id: '15550000000@s.whatsapp.net' } };
  lastSeen.installLastSeenListener(sock, { getOwnerSettings: () => owner, persist: async () => false, now: () => 1234 });
  ev.emit('presence.update', { presences: { '15551234567@s.whatsapp.net': { lastKnownPresence: 'available' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(owner.lastSeenRecords, {});
});

test('10. Regression: IDs 39/40 and Meta AI Status Reply stay intact; retired options cannot inject reply context', () => {
  const map = productionMap();
  assert.equal(typeof map['39.1'], 'function');
  assert.equal(typeof map['39.2'], 'function');
  assert.equal(typeof map['40.1'], 'function');
  assert.equal(typeof map['40.2'], 'function');
  const section32 = source.slice(source.indexOf('"32.1": s =>'), source.indexOf('"30.1": s =>'));
  assert.match(section32, /s\.statusReply = true/);
  assert.match(section32, /s\.statusReply = false/);
  assert.doesNotMatch(source, /s\.contactReply = true|s\.aiTag = true/);
  assert.doesNotMatch(source, /_owS2\?\.aiTag/);
  const statusReplyContext = fs.readFileSync(path.join(ROOT, 'mias/precious-fixes-v36.cjs'), 'utf8');
  const badgeContext = fs.readFileSync(path.join(ROOT, 'mias/precious-fixes-v37.cjs'), 'utf8');
  assert.match(statusReplyContext, /if \(!owS\.statusReply\) return null;/);
  assert.match(badgeContext, /if \(owS\.statusReply\)/);
});
