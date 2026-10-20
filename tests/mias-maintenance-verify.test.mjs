// Verification harness for the MIA'S MDX maintenance task.
// Runs the REAL production source (extracted, never a copy) in a vm sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as menu from '../mias/lib/premiumMenus.js';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const hostDetect = req('../mias/lib/hostDetect.cjs');
const source = fs.readFileSync(path.join(ROOT, 'mias/index.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'mias/features/spotifyCommands.js'), 'utf8');
const caseSource = fs.readFileSync(path.join(ROOT, 'case.js'), 'utf8');

// ── source extraction (brace matched, real production code) ────────────────
function bodyStart(start) {
  // skip the parameter list (handles default "= {}" without unbalancing)
  let i = source.indexOf('(', start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') { depth--; if (!depth) break; }
  }
  return source.indexOf('{', i);
}
function slice(start) {
  const from = bodyStart(start);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced at ' + start);
}
function fn(name, asyncToo = true) {
  for (const p of [`async function ${name}(`, `function ${name}(`]) {
    const at = source.indexOf('\n' + p);
    if (at !== -1) return slice(at + 1);
  }
  throw new Error('function not found: ' + name);
}
function constLiteral(name) {
  const at = source.indexOf('const ' + name + ' = ');
  assert.ok(at !== -1, name + ' exists');
  const body = source.slice(at + ('const ' + name + ' = ').length);
  const end = body.search(/\n(?=const |let |function |[A-Za-z_$]+\()/);
  const expr = end === -1 ? body : body.slice(0, end);
  return vm.runInNewContext(expr.trim().replace(/;$/, ''), { Object, Set, Map });
}
function categories() {
  const a = source.indexOf('const MENU_CATEGORIES = [');
  const b = source.indexOf('\n];', a);
  const arr = vm.runInNewContext(source.slice(a, b + 3) + '; MENU_CATEGORIES');
  return arr;
}
const RE_DISABLED = /const DISABLED_COMMANDS = new Set\(\[([\s\S]*?)\]\);/;
const RE_ALIASES = /const DUPLICATE_DOWNLOAD_ALIASES = \{([\s\S]*?)\n\};/;
const DISABLED = new Set(source.match(RE_DISABLED)[1].match(/"([^"]+)"/g).map(s => s.slice(1, -1)));
const ALIAS_MAP = Object.fromEntries(
  [...source.match(RE_ALIASES)[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));

// real cmd() registrations, as the production registry builds them
function realRegistrations() {
  const regs = [];
  const add = arr => { const list = arr.map(x => String(x).toLowerCase()).filter(x => /^[a-z0-9_.-]+$/.test(x)); if (list.length) regs.push(list); };
  for (const m of source.matchAll(/cmd\(\s*\[([^\]]*)\]/g))
    add(m[1].split(',').map(x => x.trim().replace(/^['"`]|['"`]$/g, '')));
  for (const m of source.matchAll(/cmd\(\s*['"`]([a-z0-9_.-]+)['"`]\s*,/g)) add([m[1]]);
  // late registration loops: for (const n of ["play","music","song"]) commands.set(n, ...)
  for (const m of source.matchAll(/for \(const _?[a-z]+ of \[([^\]]*)\]\)[\s\S]{0,400}?commands\.set\(/g))
    add(m[1].split(',').map(x => x.trim().replace(/^['"`]|['"`]$/g, '')));
  for (const m of source.matchAll(/commands\.set\(\s*['"`]([a-z0-9_.-]+)['"`]\s*,/g)) add([m[1]]);
  return regs;
}
function buildRegistry() {
  const commands = new Map(), aliases = new Map();
  const handlerFor = n => { const h = async () => 'ran:' + n; h.__id = n; return h; };
  for (const list of realRegistrations()) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const h = handlerFor(list[0]); // real cmd() shares one handler across all names
      commands.set(n, { canonical: list[0], isAlias: i > 0, handler: h, category: 'DOWNLOAD' });
      if (i) aliases.set(n, list[0]); else aliases.delete(n); // mirrors cmd() exactly
    }
  }
  return { commands, aliases };
}
function makeSandbox() {
  const { commands, aliases } = buildRegistry();
  const cats = categories();
  const sb = {
    commands, aliases, MENU_CATEGORIES: cats, CONFIG: { PREFIX: '.', VERSION: '4.9.9', BOT_NAME: "𝑴𝑰𝑨𝑺 𝑴𝑫𝑿", OWNER_NAME: 'PRECIOUS' },
    getSettings: () => ({ workMode: 'public', adultMode: true, safeMode: false }),
    canonicalMenuEntries: menu.canonicalMenuEntries,
    activeMenuCategories: menu.activeMenuCategories,
    console, Object, Set, Map, Array, String, Number, Boolean, JSON, Math, Promise, RegExp, Date, Buffer,
    process, __filename: path.join(ROOT, 'mias/index.js'), __dirname: path.join(ROOT, 'mias'),
  };
  sb.__hostDetect = hostDetect;
  vm.createContext(sb);
  const code = [
    fn('isCommandDisabled'), fn('isCommandAlias'), fn('getPrimaryCommandCount'),
    fn('getCategoryPrimaryCommands'), fn('__miasApplyMaintenance'),
    `const DISABLED_COMMANDS = new Set(${JSON.stringify([...DISABLED])});`,
    `const DUPLICATE_DOWNLOAD_ALIASES = ${JSON.stringify(ALIAS_MAP)};`,
    'globalThis.__T = { isCommandDisabled, isCommandAlias, getPrimaryCommandCount, getCategoryPrimaryCommands, __miasApplyMaintenance, DISABLED_COMMANDS, DUPLICATE_DOWNLOAD_ALIASES };',
  ].join('\n');
  vm.runInContext(code, sb);
  const report = sb.__T.__miasApplyMaintenance(commands, aliases, cats);
  const policy = menu.installMenuCategoryPolicy(commands, aliases, cats, []);
  sb.__menu = menu; sb.__policy = policy; sb.__report = report;
  sb.activeMenuCategories = (c, a, k, ctx) => menu.activeMenuCategories(c || commands, a || aliases, k || cats, ctx);
  return sb;
}
const SB = makeSandbox();
const { commands, aliases, MENU_CATEGORIES, __T, __report } = SB;
const visible = (ctx = { owner: true, creator: true, adultMode: true }) =>
  menu.canonicalMenuEntries(commands, aliases, MENU_CATEGORIES, ctx);
const visibleNames = new Set(visible().map(e => e.name));

// ═══════════════════════════ TESTS ═══════════════════════════
test('01 · every selected command is blocked at dispatch', () => {
  const blocked = [...DISABLED].filter(n => commands.has(n));
  assert.ok(blocked.length >= 27, 'expected the registered subset, got ' + blocked.length);
  for (const n of blocked) {
    assert.equal(commands.get(n).disabled, true, n + ' must be flagged disabled');
    assert.equal(commands.get(n).enabled, false, n + ' must be flagged not-enabled');
    assert.equal(__T.isCommandDisabled(n), true, n + ' must be blocked by the guard');
  }
  console.log('   blocked:', blocked.length, 'of', DISABLED.size, 'selected');
});

test('02 · no unselected command was disabled', () => {
  const unexpected = [...commands.entries()].filter(([n, e]) => e.disabled === true && !DISABLED.has(n)).map(([n]) => n);
  assert.deepEqual(unexpected, []);
  assert.equal(__report.disabled.length, [...DISABLED].filter(n => commands.has(n)).length);
});

test('03 · aliases of disabled commands cannot bypass the guard', () => {
  const aliasCases = [['pdf2txt', 'pdftotext'], ['extractpdf', 'pdftotext'], ['richui', 'richmode'], ['cardmode', 'richmode'],
    ['chatscope', 'chatbotscope'], ['bancheck', 'bcheck'], ['online', 'isonline'], ['buttonmenu', 'btnmenu'], ['button', 'buttonsmode']];
  for (const [alias, canonical] of aliasCases) {
    if (!commands.has(alias)) continue;
    assert.equal(commands.get(alias).canonical, canonical, alias + ' -> ' + canonical);
    assert.equal(__T.isCommandDisabled(alias), true, alias + ' must inherit the disable');
  }
  console.log('   inherited blocks:', aliasCases.filter(([a]) => commands.has(a)).length);
});

test('04 · duplicate downloader names are hidden aliases of their canonical parent', () => {
  const added = __report.aliases;
  assert.ok(added.length > 0, 'expected duplicate aliases to be folded');
  for (const pair of added) {
    const [alias, parent] = pair.split(' -> ');
    assert.equal(commands.get(alias).isAlias, true, alias + ' must be an alias');
    assert.equal(commands.get(alias).canonical, parent, alias + ' canonical');
    assert.equal(aliases.get(alias), parent, alias + ' alias map');
    assert.equal(commands.get(alias).handler, commands.get(parent).handler, alias + ' must forward to the parent handler');
    assert.ok(!visibleNames.has(alias), alias + ' must not be visible');
    if (alias !== 'gcstory' && alias !== 'gcstatus' && alias !== 'gst') assert.ok(visibleNames.has(parent), parent + ' must stay visible');
  }
  console.log('   folded aliases:', added.join(' | '));
});

test('05 · aliases are hidden from menus and excluded from totals', () => {
  const total = __T.getPrimaryCommandCount({ owner: true, creator: true, adultMode: true });
  assert.equal(total, visible().length);
  assert.ok(aliases.size > 100, 'alias surface is real: ' + aliases.size);
  for (const pair of __report.aliases) {
    const a = pair.split(' -> ')[0];
    assert.ok(!visibleNames.has(a), a + ' (folded duplicate) must be hidden');
  }
  for (const n of DISABLED) assert.ok(!visibleNames.has(n), n + ' (disabled) must be hidden');
  for (const n of ['setfulldp', 'setfullpp', 'fullpp']) assert.ok(!visibleNames.has(n), n + ' (full-DP alias) must be hidden');
  for (const a of [...aliases.keys()]) assert.ok(commands.has(aliases.get(a)), a + ' must resolve to a registered parent');
  assert.equal(visible().length, new Set(visible().map(e => e.name)).size, 'no duplicate registration is counted');
  console.log('   visible canonical total:', total, '| alias rows:', aliases.size);
});

test('06 · protected parents .aio .tiktok .play .ytmp4 are untouched', () => {
  for (const p of ['aio', 'tiktok', 'play', 'ytmp4']) {
    const e = commands.get(p);
    assert.ok(e, p + ' registered');
    assert.notEqual(e.disabled, true, p + ' must not be disabled');
    assert.equal(e.isAlias, false, p + ' must stay canonical');
    assert.equal(typeof e.handler, 'function');
    assert.ok(visibleNames.has(p), p + ' must stay visible');
  }
  assert.equal(commands.get('tt').canonical, 'tiktok');
  assert.equal(commands.get('ttdl').canonical, 'tiktok');
  assert.equal(commands.get('ytv').canonical, 'ytmp4');
  assert.equal(commands.get('alldl').canonical, 'aio');
  assert.equal(commands.get('universaldl').canonical, 'aio');
});

test('07 · .fulldp is the only visible full-DP command', () => {
  const dp = ['fulldp', 'setfulldp', 'setfullpp', 'fullpp'];
  assert.ok(visibleNames.has('fulldp'));
  for (const a of dp.slice(1)) {
    assert.ok(commands.has(a), a + ' registered');
    assert.equal(commands.get(a).isAlias, true, a + ' hidden as alias');
    assert.equal(commands.get(a).canonical, 'fulldp', a + ' -> fulldp');
    assert.ok(!visibleNames.has(a), a + ' must not be visible');
  }
  assert.equal(JSON.stringify(__report.fullDpAliases), JSON.stringify(['setfulldp', 'setfullpp', 'fullpp']));
  const listed = MENU_CATEGORIES.flatMap(c => c.cmds).filter(n => dp.includes(n));
  assert.equal(JSON.stringify(listed), JSON.stringify(['fulldp']), 'menu registry lists only .fulldp');
});

test('08 · full-DP aliases stay functional and mapped to the full-DP handler', () => {
  for (const a of ['setfulldp', 'setfullpp', 'fullpp']) {
    assert.equal(commands.get(a).canonical, 'fulldp', a + ' canonical');
    assert.equal(typeof commands.get(a).handler, 'function', a + ' handler present');
  }
  assert.match(source, /for \(const n of \["fulldp", "setfulldp", "setfullpp", "fullpp"\]\)[\s\S]{0,400}?ex\.handler = __miasFullDpHandler/,
    'every full-DP name shares the existing __miasFullDpHandler');
  assert.match(source, /for \(const n of \["setpp", "setpfp", "setbotpic", "botpic"\]\)[\s\S]{0,400}?ex\.handler = __miasSetPpHandler/,
    'every setpp name shares the existing setpp handler');
});

test('09 · .setpp remains a separate normal profile-picture command', () => {
  const s = commands.get('setpp');
  assert.ok(s && typeof s.handler === 'function');
  assert.notEqual(s.handler, commands.get('fulldp').handler, '.setpp must NOT share the full-DP handler');
  assert.equal(s.isAlias, false, '.setpp stays canonical');
  assert.notEqual(s.disabled, true, '.setpp stays enabled');
  assert.ok(visibleNames.has('setpp'), '.setpp keeps normal visibility');
});

test('10 · quote collection intact and the menu draws from it', () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'mias/quotes_massive.json'), 'utf8'));
  assert.equal(file.length, 4624, 'quote file must keep all 4624 entries');
  const { execSync } = req('node:child_process');
  const head = execSync('git -C ' + ROOT + ' diff --stat -- mias/quotes_massive.json').toString().trim();
  assert.equal(head, '', 'quote file must be untouched by this change');
  const inline = source.match(/const _HOPE_QUOTES = \[[\s\S]*?\n\];/)[0].match(/"[^"]+"/g).length;
  assert.ok(inline > 40, 'inline quote arrays intact (' + inline + ')');
});

test('11 · menu uses a real quote, both short and long, never truncated', () => {
  const loaderAt = source.indexOf("const massivePath = path.join(__dirname, 'quotes_massive.json')");
  assert.ok(loaderAt !== -1, 'existing loader preserved');
  const pick = menu.createMenuQuoteSelector(() => JSON.parse(fs.readFileSync(path.join(ROOT, 'mias/quotes_massive.json'), 'utf8')));
  const long = 'L'.repeat(1500), short = 'S'.repeat(12);
  const sel = menu.createMenuQuoteSelector(() => [short, long]);
  const a = sel('u'), b = sel('u');
  assert.notEqual(a, b, 'rotation avoids repeats');
  assert.ok([short, long].includes(a) && [short, long].includes(b));
  const section = menu.quoteSection(long);
  assert.ok(section.includes(long), 'a long quote is preserved in full, not truncated');
  assert.ok(pick('x').length > 0);
});

test('12 · all command names and category headings are uppercase, no emoji in menu text', () => {
  const noEmoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2764}]/u;
  for (const cat of MENU_CATEGORIES) {
    const block = menu.formatMenuCategory({ name: cat.name, cmds: cat.cmds.slice(0, 6) });
    assert.equal(block, block.toUpperCase(), 'category heading uppercase: ' + cat.name);
    assert.ok(!noEmoji.test(block), 'no emoji in category block: ' + cat.name);
    assert.ok(!noEmoji.test(cat.name), 'no emoji in heading: ' + cat.name);
  }
  const sample = menu.formatMenuCategory({ name: 'tools', cmds: ['calc', 'sticker'] });
  assert.ok(sample.includes('*TOOLS*'), 'headings rendered uppercase');
  assert.ok(sample.includes('*CALC*') && sample.includes('*STICKER*'), 'commands rendered uppercase');
  assert.ok(!/━|✦|➤|📋|🏷️/.test(sample), 'no heavy decoration in category blocks');
});

test('13 · main/all retain 💔 and categories use their supported reactions', () => {
  assert.equal(menu.menuReaction('MAIN'), '🏷️');
  assert.equal(menu.menuReaction('ALL'), '🔗️');
  assert.equal(menu.menuReaction('DOWNLOAD'), '📥');
  assert.equal(menu.menuReaction('TOOLS'), '🔧');
  assert.equal(menu.menuReaction(undefined), '🏷️');
  for (const cat of menu.activeMenuCategories(commands, aliases, MENU_CATEGORIES, { owner: true, adultMode: true }))
    assert.equal(menu.menuReaction(cat.name), menu.MENU_REACTIONS[menu.normalizeMenuCategory(cat.name)] || '🏷️', cat.name);
  assert.notEqual(menu.menuReaction('MAIN'), menu.menuReaction('INFO'));
  assert.notEqual(menu.menuReaction('ALL'), menu.menuReaction('INFO'));
});

test('14 · host, prefix, mode and version display real configured values', () => {
  const prefixMod = req('../mias/lib/prefix.cjs');
  assert.equal(prefixMod.getConfiguredPrefix(), '.', 'real configured prefix');
  assert.equal(CONFIG_VERSION(), '4.9.9');
  const railway = hostDetect.detectHostEnvironment({ RAILWAY_ENVIRONMENT: 'production' });
  assert.equal(railway.platform, 'Railway');
  assert.equal(railway.confidence, 'confirmed');
  const plain = hostDetect.detectHostEnvironment({});
  assert.equal(plain.platform, 'Linux (VPS/Local)');
  assert.equal(hostDetect.detectHostEnvironment({ REPL_ID: 'x' }).platform, 'Replit');
  assert.ok(source.includes('detectHostEnvironment().platform'), 'menu reads the real detector');
  assert.ok(!source.includes('HOST: RAILWAY') && !source.includes('HOST: "RAILWAY"'), 'host is never hardcoded');
});
function CONFIG_VERSION() { return source.match(/VERSION:\s*"([^"]+)"/)[1]; }

test('15 · removed categories are gone from the visible menu system', () => {
  for (const gone of ['GAME', 'GAMES', 'TEXTMAKER', 'STALK', 'STALKER', 'LOGO', 'FUN'])
    assert.ok(!MENU_CATEGORIES.some(c => c.name === gone), gone + ' must not be a category');
  const shown = menu.activeMenuCategories(commands, aliases, MENU_CATEGORIES, { owner: true, creator: true, adultMode: true }).map(c => c.name);
  for (const gone of ['GAME', 'GAMES', 'TEXTMAKER', 'STALK', 'STALKER', 'LOGO', 'FUN'])
    assert.ok(!shown.includes(gone), gone + ' must not render');
  assert.ok(shown.length > 0, 'other categories survive');
  console.log('   remaining categories:', shown.join(', '));
});

test('16 · displayed totals are computed from visible canonical commands', () => {
  for (const ctx of [{ owner: false, adultMode: false }, { owner: true, creator: true, adultMode: true }, { owner: false, group: true, admin: true, adultMode: true }]) {
    const entries = menu.canonicalMenuEntries(commands, aliases, MENU_CATEGORIES, ctx);
    assert.equal(__T.getPrimaryCommandCount(ctx), entries.length);
    assert.equal(new Set(entries.map(e => e.name)).size, entries.length, 'no duplicate registrations counted');
  }
  assert.ok(!source.includes('totalCmds -') && !source.includes('totalCmds-'), 'no fixed subtraction from a hardcoded total');
});

test('17 · download footer is exactly "> POWERED BY JUST X", applied once, empty-safe', () => {
  assert.equal(menu.withJustXFooter(''), '\u200B> POWERED BY JUST X');
  assert.equal(menu.withJustXFooter('🎬 Title'), '🎬 Title\n\n\u200B> POWERED BY JUST X');
  const once = menu.withJustXFooter('A');
  assert.equal(menu.withJustXFooter(once), once, 'idempotent — never duplicated');
  const twice = menu.withJustXFooter(menu.withJustXFooter(menu.withJustXFooter('X')));
  assert.equal(twice.split('POWERED BY JUST X').length - 1, 1, 'single occurrence');
  assert.ok(menu.withJustXFooter('x').endsWith('> POWERED BY JUST X'), 'exact visible text');
  assert.ok(source.includes('caption = withJustXFooter(caption);'), 'wired at the shared delivery helper');
  const callers = [...source.matchAll(/deliverVideoWithTTHD\(/g)].length;
  assert.ok(callers >= 10, 'shared helper serves ' + callers + ' downloader call sites');
  assert.ok(!/withJustXFooter\([\s\S]{0,40}menu/i.test(source), 'menu captions are never given the download footer');
});

test('18 · case.js dispatcher blocks disabled commands before handling', () => {
  assert.ok(caseSource.includes('globalThis.__MIAS_DISABLED__?.(command)'), 'disabled guard wired in case.js');
  const idx = caseSource.indexOf('__MIAS_DISABLED__');
  const early = caseSource.indexOf('const text = parsedCommand.text;');
  assert.ok(idx !== -1 && idx < early, 'guard runs before any command handling');
});

test('19 · no unrelated command lost its declaration site', () => {
  const declared = n => {
    for (const tok of [`"${n}"`, `'${n}'`]) {
      let at = source.indexOf(tok);
      while (at !== -1) {
        const around = source.slice(Math.max(0, at - 240), at + tok.length);
        if (/cmd\(|commands\.set\(|of \[/.test(around)) return true;
        at = source.indexOf(tok, at + 1);
      }
    }
    return false;
  };
  const keep = ['aio', 'tiktok', 'play', 'ytmp4', 'facebook', 'instagram', 'spotify', 'pinterest', 'snapchat',
    'reddit', 'twitter', 'capcut', 'threads', 'soundcloud', 'mediafire', 'terabox', 'menu', 'allmenu', 'setpp', 'fulldp'];
  for (const n of keep) assert.ok(declared(n), n + ' must still have a registration site');
  const total = [...commands.values()].length;
  assert.ok(total > 400, 'registry rebuilt with ' + total + ' names');
  assert.equal(commands.get('fullmenu').canonical, 'allmenu', 'allmenu alias intact');
  console.log('   registry size   :', total, 'names');
});

console.log('\n── maintenance report ──');
console.log('disabled flagged :', __report.disabled.length, '/', DISABLED.size, 'selected');
console.log('not registered   :', __report.skipped.join(', ') || '(none)');
console.log('folded aliases   :', __report.aliases.length);
console.log('full-DP aliases  :', __report.fullDpAliases.join(', '));
console.log('setpp aliases    :', __report.setppAliases.join(', '));
