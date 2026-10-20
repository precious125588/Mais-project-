// Isolated regression checks: never import the bot entrypoint or start a socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as menu from '../mias/lib/premiumMenus.js';
import * as adapter from '../mias/handlers/menuConfig.js';
import { createQueuedSaveCreds } from '../mias/lib/sessionHealth.js';
const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../mias/index.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n(?:async function |function |const |cmd\(|  try \{\n  const cuzMod)/);
  assert.ok(next >= 0);
  return source.slice(start, start + 1 + next).trim();
}
function literal(name, expression) {
  const match = source.match(expression);
  assert.ok(match, name);
  return vm.runInNewContext(match[1]);
}
function registryHarness() {
  const commands = new Map(), aliases = new Map();
  const DISABLED_COMMANDS = literal('disabled', /const DISABLED_COMMANDS = (new Set\(\[[\s\S]*?\]\));/);
  const OWNER_SETTINGS_COMMANDS = literal('settings', /const OWNER_SETTINGS_COMMANDS = (new Set\(\[[\s\S]*?\]\));/);
  const RISKY_CMDS = new Set(['shell']);
  const sandbox = { commands, aliases, DISABLED_COMMANDS, OWNER_SETTINGS_COMMANDS, RISKY_CMDS, Map, Set, String, Boolean, _miasPrivateBlocks: () => false };
  vm.createContext(sandbox);
  vm.runInContext([fn('cmd'), fn('isCommandDisabled'), fn('jointCommandAllowed')].join('\n'), sandbox);
  return { ...sandbox, sandbox };
}
function registerNexray(h, { fail = false } = {}) {
  const sent = [];
  const nx = { tools: { telegramSticker: async ({ url }) => {
    assert.equal(url, 'https://example.test/input.jpg');
    if (fail) throw Error('mock provider unavailable');
    return { type: 'media', buffer: Buffer.alloc(1024, 3), contentType: 'image/png' };
  } } };
  require('../mias/nexray_bot.cjs')(h.cmd, { PREFIX: '.' }, async (sock, msg, text) => sent.push({ text }), async () => {}, async function* () {}, {}, nx);
  return sent;
}
test('both exclusion lists hide canonical/alias selections without disabling execution', async () => {
  const h = registryHarness();
  for (const name of [...menu.SEARCH_MENU_EXCLUSIONS, ...menu.TOOLS_MENU_EXCLUSIONS]) h.cmd([name, name + '-probe'], { category: 'TOOLS' }, async () => name);
  for (const name of ['time', 'tg-sticker', 'calc', 'fulldp', 'setpp', 'setaza', 'web2zip']) h.cmd([name], { category: 'TOOLS' }, async () => name);
  const entries = menu.canonicalMenuEntries(h.commands, h.aliases);
  for (const name of [...menu.SEARCH_MENU_EXCLUSIONS, ...menu.TOOLS_MENU_EXCLUSIONS]) {
    assert.ok(!entries.some(e => e.name === name), name);
    assert.equal(await h.commands.get(name).handler(), name);
    assert.equal(h.isCommandDisabled(name), false, name + ' is menu-only');
    assert.equal(h.commands.get(name + '-probe').handler, h.commands.get(name).handler);
  }
  for (const name of ['time', 'tg-sticker', 'calc', 'fulldp', 'setpp', 'setaza']) assert.ok(entries.some(e => e.name === name));
  assert.equal(h.isCommandDisabled('web2zip'), true);
  assert.equal(h.isCommandDisabled('webtozip'), false);
});
test('selected aliases resolve only to their actual canonical; apple display label is explicit', async () => {
  const h = registryHarness();
  h.cmd(['realcompile', 'codecompile'], { category: 'TOOLS' }, () => 1);
  h.cmd(['applemusic'], { category: 'SEARCH' }, () => 2);
  h.cmd(['unselected'], { category: 'SEARCH' }, () => 3);
  assert.deepEqual(menu.canonicalMenuEntries(h.commands, h.aliases).map(e => e.name), ['unselected']);
  assert.deepEqual(menu.menuExclusionReport(h.commands, h.aliases).tools.mappings, [{ selected: 'codecompile', canonical: 'realcompile' }]);
  assert.equal(menu.MENU_DISPLAY_LABELS['apple music'], 'applemusic');
  assert.equal(h.commands.has('apple music'), false);
  assert.equal(await h.commands.get('realcompile').handler(), 1);
});
test('real Nexray registration keeps tg-sticker visible in TOOLS and handler delivers mocked media', async () => {
  const h = registryHarness(); registerNexray(h);
  const entry = h.commands.get('tg-sticker'); assert.equal(typeof entry.handler, 'function');
  assert.equal(h.aliases.get('telegramsticker'), 'tg-sticker');
  assert.equal(h.commands.get('telegramsticker').handler, entry.handler);
  const tools = menu.activeMenuCategories(h.commands, h.aliases, []).find(cat => cat.name === 'TOOLS');
  assert.ok(tools.cmds.includes('tg-sticker')); assert.equal(tools.cmds.length, new Set(tools.cmds).size);
  const sent = [];
  const sock = { sendMessage: async (jid, payload) => sent.push(payload) };
  await entry.handler(sock, { key: { remoteJid: 'mock-chat' } }, ['https://example.test/input.jpg']);
  assert.equal(sent.length, 1); assert.ok(Buffer.isBuffer(sent[0].image));
});
test('tg-sticker missing input and provider failure return truthful errors, not success media', async () => {
  const h = registryHarness(); const replies = registerNexray(h, { fail: true });
  const msg = { key: { remoteJid: 'mock-chat' } };
  const sock = { sendMessage: async () => { throw Error('unexpected media send'); } };
  await h.commands.get('tg-sticker').handler(sock, msg, []);
  assert.match(replies.at(-1).text, /Usage/);
  await h.commands.get('tg-sticker').handler(sock, msg, ['https://example.test/input.jpg']);
  assert.match(replies.at(-1).text, /mock provider unavailable/);
});
test('real time handler runs locally and time is included once in TOOLS', async () => {
  const h = registryHarness(); const replies = [];
  Object.assign(h.sandbox, { Date, sendReply: async (sock, msg, text) => replies.push(text) });
  const start = source.indexOf('cmd("time",');
  const end = source.indexOf('\n});', start) + 4;
  vm.runInContext(source.slice(start, end), h.sandbox);
  await h.commands.get('time').handler({}, { key: { remoteJid: 'mock-chat' } }, []);
  assert.match(replies[0], /Current Time/); assert.match(replies[0], /UTC:/);
  assert.deepEqual(menu.activeMenuCategories(h.commands, h.aliases, []).map(c => [c.name, [...c.cmds]]), [['TOOLS', ['time']]]);
});
test('setaza is not disabled; all disabled canonical names and aliases reject even late registration', async () => {
  const h = registryHarness();
  assert.equal(h.DISABLED_COMMANDS.has('setaza'), false);
  h.cmd(['setaza'], { category: 'INFO', ownerOnly: true }, () => 10);
  assert.equal(h.isCommandDisabled('setaza'), false);
  const categories = [];
  menu.installMenuCategoryPolicy(h.commands, h.aliases, categories, [], h.isCommandDisabled);
  for (const name of h.DISABLED_COMMANDS) {
    h.cmd([name, 'probe-' + name], { category: 'TOOLS' }, () => 20);
    assert.equal(h.isCommandDisabled(name), true);
    assert.equal(h.isCommandDisabled('probe-' + name), true);
    assert.equal(h.commands.get(name)?.disabled, true);
    assert.equal(h.jointCommandAllowed('probe-' + name, h.commands.get('probe-' + name), { owner: true, creator: true }), false);
  }
  assert.equal(await h.commands.get('setaza').handler(), 10);
  assert.ok(menu.canonicalMenuEntries(h.commands, h.aliases).some(e => e.name === 'setaza'));
});
test('chained dispatch denies owner, creator, admin, banned, safe-mode and disabled bypasses', () => {
  const h = registryHarness();
  const check = (name, opts, context = {}) => { h.cmd([name], { category: 'TOOLS', ...opts }, () => true); return h.jointCommandAllowed(name, h.commands.get(name), context); };
  assert.equal(check('privateprobe', { ownerOnly: true }), false);
  assert.equal(check('privateprobe', { ownerOnly: true }, { owner: true }), true);
  assert.equal(check('creatorprobe', { creatorOnly: true }, { owner: true }), false);
  assert.equal(check('creatorprobe', { creatorOnly: true }, { creator: true }), true);
  assert.equal(check('groupprobe', { groupOnly: true }), false);
  assert.equal(check('groupprobe', { groupOnly: true }, { group: true }), true);
  assert.equal(check('adminprobe', { adminOnly: true }, { group: true }), false);
  assert.equal(check('adminprobe', { adminOnly: true }, { group: true, admin: true }), true);
  assert.equal(check('publicprobe', {}, { banned: new Set(['publicprobe']) }), false);
  assert.equal(check('shell', {}, { owner: true, safeMode: true }), false);
  assert.equal(check('settings', {}), false);
  h.cmd(['settings', 'settingsalias'], { category: 'TOOLS' }, () => true);
  assert.equal(h.jointCommandAllowed('settingsalias', h.commands.get('settingsalias'), {}), false);
  assert.equal(check('time', {}), true);
  assert.equal(check('ytmp3', {}, { owner: true }), false);
  assert.ok(source.includes('isCommandAllowedInContext(msg, fromOwner, false) && jointCommandAllowed(jointName, jointEntry, jointContext)'));
});
test('registry adapter updates counts and categories from same Map; no stale static inventory', () => {
  const saved = [globalThis.__MIAS_COMMANDS__, globalThis.__MIAS_ALIASES__, globalThis.__MIAS_MENU_CATEGORIES__];
  try {
    const h = registryHarness();
    Object.assign(globalThis, { __MIAS_COMMANDS__: h.commands, __MIAS_ALIASES__: h.aliases, __MIAS_MENU_CATEGORIES__: [] });
    h.cmd(['time', 'clock'], { category: 'TOOLS' }, () => true);
    h.cmd(['translate'], { category: 'TOOLS' }, () => true);
    h.cmd(['hiddenfun'], { category: 'FUN' }, () => true);
    assert.equal(adapter.MENU_CATEGORIES.length, 1);
    assert.equal(adapter.getCategoryById('cat_tools').cmds.length, 1);
    assert.equal(adapter.getTotalCommandCount(), 1);
    h.cmd(['calc'], { category: 'TOOLS' }, () => true);
    assert.equal(adapter.getTotalCommandCount(), 2);
    assert.equal(adapter.findCommand('translate'), null);
    assert.equal(adapter.findCommand('hiddenfun'), null);
    assert.equal(adapter.getTotalCommandCount(), menu.canonicalMenuEntries(h.commands, h.aliases).length);
  } finally {
    [globalThis.__MIAS_COMMANDS__, globalThis.__MIAS_ALIASES__, globalThis.__MIAS_MENU_CATEGORIES__] = saved;
  }
});
test('legacy UI forwarding preserves original chat/request and invokes premium renderer only once', async () => {
  const previous = globalThis.__MIAS_PREMIUM_MENU__; const calls = [];
  try {
    globalThis.__MIAS_PREMIUM_MENU__ = (...args) => calls.push(args);
    const msg = { key: { remoteJid: 'mock-chat', id: 'in-1' } }, sock = {};
    await menu.forwardPremiumMenu(sock, 'mock-chat', msg, ['cat_tools']);
    assert.equal(calls.length, 1); assert.equal(calls[0][1], msg); assert.deepEqual(calls[0][2], ['tools']);
    await assert.rejects(menu.forwardPremiumMenu(sock, 'other-chat', msg), /Original menu request/);
    assert.equal(calls.length, 1);
    delete globalThis.__MIAS_PREMIUM_MENU__;
    await assert.rejects(menu.forwardPremiumMenu(sock, 'mock-chat', msg), /not ready/);
  } finally { globalThis.__MIAS_PREMIUM_MENU__ = previous; }
});
test('session save queues serialize one fixture and keep separate sessions independent', async () => {
  let concurrent = 0, maximum = 0, count = 0;
  const save = createQueuedSaveCreds('/isolated-fixture/session-a', async () => {
    concurrent++; maximum = Math.max(maximum, concurrent);
    await new Promise(resolve => setTimeout(resolve, 2)); count++; concurrent--;
  });
  await Promise.all([save(), save(), save()]);
  assert.equal(maximum, 1); assert.equal(count, 3);
  let unblock;
  const first = createQueuedSaveCreds('/isolated-fixture/session-a', () => new Promise(resolve => { unblock = resolve; }));
  let secondSaved = false;
  const second = createQueuedSaveCreds('/isolated-fixture/session-b', async () => { secondSaved = true; });
  const pending = first(); await second(); assert.equal(secondSaved, true); unblock(); await pending;
});
test('legacy menu aliases delegate once without group joins or obsolete static listings', async () => {
  const legacy = fs.readFileSync(new URL('../case.js', import.meta.url), 'utf8');
  const start = legacy.indexOf("case 'menu':");
  const end = legacy.indexOf('\ncase "mathfact":', start);
  const block = legacy.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(!block.includes('autoJoinGroup'));
  assert.ok(!block.includes('removebg') && !block.includes('ZUKO'));
  for (const command of ['menu', 'zuko']) {
    const calls = [];
    const context = { command, args: ['tool'], m: { key: { remoteJid: 'mock-chat', id: 'original' }, chat: 'mock-chat' },
      devtrust: { sendMessage: async () => { throw Error('unexpected fallback'); } },
      __MIAS_PREMIUM_MENU__: async (...args) => calls.push(args) };
    await vm.runInNewContext('(async()=>{switch(command){' + block + '}})()', context);
    assert.equal(calls.length, 1); assert.equal(calls[0][1], context.m);
    assert.deepEqual(calls[0][2], context.args);
  }
});
test('botinfo category summary counts visible canonical entries, not aliases or removed headings', async () => {
  const h = registryHarness(); const replies = [];
  h.cmd(['time', 'clock'], { category: 'TOOLS' }, () => true);
  h.cmd(['translate'], { category: 'TOOLS' }, () => true);
  h.cmd(['jokecandidate'], { category: 'FUN' }, () => true);
  Object.assign(h.sandbox, { ...menu, MENU_CATEGORIES: [],
    CONFIG: { BOT_NAME: 'MIA', OWNER_NAME: 'Owner', PREFIX: '.', VERSION: '4.9.9' },
    menuVisibilityContext: async () => ({}), react: async () => {}, fmtUptime: () => '1m',
    process: { uptime: () => 60, memoryUsage: () => ({ rss: 1024, heapUsed: 512 }), version: 'v22-test' },
    os: { totalmem: () => 4096, cpus: () => [], arch: () => 'mock', type: () => 'mock' },
    _detectHost: () => 'isolated fixture', getBotPic: async () => null,
    sendReply: async (sock, msg, text) => replies.push(text), sendCTAButtons: async () => {} });
  const start = source.indexOf('cmd("botinfo",');
  const end = source.indexOf('\n});', start) + 4;
  vm.runInContext(source.slice(start, end), h.sandbox);
  await h.commands.get('botinfo').handler({}, { key: { remoteJid: 'mock-chat' } }, []);
  assert.match(replies[0], /Total Commands:\* 2/);
  assert.match(replies[0], /TOOLS: 1/);
  assert.ok(!replies[0].includes('FUN:'));
});
test('optional video fallback skips missing API credentials and preserves configured requests', async () => {
  const match = source.match(/async \(\) => \{\n\s+const apikey = process\.env\.NEXORACLE_API_KEY;[\s\S]*?\n\s+\}/);
  assert.ok(match, 'production fallback exists');
  const calls = [], context = { process: { env: {} }, url: 'https://example.test/video',
    axios: { get: async (url, options) => { calls.push({ url, options }); return { data: { result: { download_url: 'https://example.test/output.mp4' } } }; } } };
  const provider = vm.runInNewContext('(' + match[0] + ')', context);
  assert.equal(await provider(), null); assert.equal(calls.length, 0);
  context.process.env.NEXORACLE_API_KEY = 'test-only-not-a-real-key';
  assert.equal(await provider(), 'https://example.test/output.mp4');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.params.apikey, context.process.env.NEXORACLE_API_KEY);
  assert.equal(calls[0].options.timeout, 45000);
});
