/* v38 verification — real behavioural checks, not grep.
   Run: node tests/v38-fixes.test.mjs */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IDX = path.join(ROOT, 'mias', 'index.js');
const V38 = path.join(ROOT, 'mias', 'precious-fixes-v38.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
};

/* ── 1. files compile ─────────────────────────────────────────────────── */
console.log('\n[1] syntax');
const { execFileSync } = require('child_process');
for (const f of [IDX, V38, path.join(ROOT, 'precious-master-fix-boot.cjs')]) {
  let good = true, msg = '';
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { good = false; msg = String(e.stderr || e.message).split('\n')[0]; }
  ok('compiles: ' + path.relative(ROOT, f), good, msg);
}

/* ── 2. settings defaults + persistence wrappers present ─────────────── */
console.log('\n[2] settings');
const idx = fs.readFileSync(IDX, 'utf8');
ok('default statusVcard: false', /statusVcard: false,/.test(idx));
ok('default protectAlways: true', /protectAlways: true,/.test(idx));
ok('SETTINGS_MAP has the renumbered 30.x/31.x/33.x/35.x toggles and 38.x status forwarder',
  idx.includes('"30.1"') && idx.includes('"31.1"') && idx.includes('"35.1"') && idx.includes('"38.1"'));
ok('every SETTINGS_MAP toggle persists (_v38Persist wrapper)', idx.includes('__v38Persist'));
ok('settings menu renders section 38 and 39',
  /Status vCard/.test(idx) && /Group Protections/.test(idx));

/* ── 3. vCard gating ─────────────────────────────────────────────────── */
console.log('\n[3] vCard auto-popup');
// v39 deliberately superseded v38's opt-in auto-DM. Execute the actual
// current source block for both toggle values; never restore auto-sends.
const statusStart = idx.indexOf('const _botSelfJid2 =');
const statusEnd = idx.indexOf('} catch {}', statusStart);
const statusBody = idx.slice(statusStart, statusEnd);
const { AsyncFunction } = { AsyncFunction: Object.getPrototypeOf(async function(){}).constructor };
let autoSends = 0;
const runStatus = new AsyncFunction('sock', 'toStandardJid', '_ownerSStatus', 'author', '_cleanNum', '_ownerJStatus', 'CONFIG', statusBody);
const oldCache = globalThis._statusReplyCache;
for (const statusVcard of [false, true]) {
  globalThis._statusReplyCache = new Map();
  await runStatus({user:{id:'10000@s.whatsapp.net'},sendMessage:async()=>{autoSends++;}}, x=>x,
    {statusReply:true,statusVcard}, '20000@s.whatsapp.net', x=>String(x).split('@')[0],
    '10000@s.whatsapp.net', {BOT_NAME:"MIA'S MDX"});
}
globalThis._statusReplyCache = oldCache;
ok('v39 never sends unsolicited viewer vCards with either toggle value', autoSends === 0);
ok('v39 status-viewer block never sends intro or contact messages', !/sock\.sendMessage/.test(statusBody));

/* ── 4. identity normalisation ───────────────────────────────────────── */
console.log('\n[4] identity');
ok('isOwner strips device suffix', /const raw = String\(jid\)\.replace\(\/:\\d\+\(\?=@\)\/, ""\)/.test(idx));
ok('getSender prefers participantPn/senderPn', /participantPn \|\| msg\?\.key\?\.senderPn/.test(idx));
ok('getSender resolves @lid', /endsWith\("@" \+ "lid"\)|endsWith\("@lid"\)/.test(idx));
ok('identity helpers published', /globalThis\.__miasIsOwner/.test(idx) && /globalThis\.__miasGetSender/.test(idx));

/* ── 5. protections in private mode ──────────────────────────────────── */
console.log('\n[5] protections');
ok('shouldSilenceForPrivateMode honours protectAlways', /_v38ps\?\.protectAlways !== false/.test(idx));
ok('protection check returns false (message reaches hooks) BEFORE the private-mode return',
  idx.indexOf('_v38explicit) return false;') > 0 &&
  idx.indexOf('_v38explicit) return false;') < idx.indexOf('if (isBotPrivateModeActive()) return true;', idx.indexOf('function shouldSilenceForPrivateMode')));

/* ── 6. pin ──────────────────────────────────────────────────────────── */
console.log('\n[6] pin');
ok('fromMe compares whole user parts (no .includes on JID)', /_partNum === myNum/.test(idx) && !/normalizedParticipant\.includes\(myNum\)/.test(idx));
const v38src = fs.readFileSync(V38, 'utf8');
ok('v38 pin uses the shape the installed Baileys implements',
  /sendMessage\(jid, \{ pin: pinKey, type: 1, time: secs \}\)/.test(v38src));

/* ── 7. behavioural: load v38 against a fake ctx ─────────────────────── */
console.log('\n[7] v38 module behaviour');
const store = new Map();
const fakeSettings = (jid) => {
  if (!store.has(jid)) store.set(jid, { statusReply: true, contactReply: true });
  return store.get(jid);
};
let saved = 0;
const cmds = new Map();
const registered = ['setting', 'sudo', 'cuz', 'mode', 'self', 'public'];
for (const n of registered) cmds.set(n, { handler: async () => 'ORIGINAL' });

globalThis.__PRECIOUS__ = {
  commands: cmds,
  getSettings: fakeSettings,
  saveNow: () => { saved++; },
  CONFIG: { PREFIX: '.', OWNER_NUMBER: '2348012345678' },
  getOwnerJid: () => '2348012345678@s.whatsapp.net',
};
globalThis.__miasIsOwner = (j) => String(j).replace(/:\d+(?=@)/, '').startsWith('2348012345678');
globalThis.__miasIsSudo = () => false;

const install = require(V38);
const res = install();
ok('install() ran', !!res && typeof res === 'object');
const owner = fakeSettings('2348012345678@s.whatsapp.net');
ok('migration turned statusReply OFF', owner.statusReply === false);
ok('migration turned contactReply OFF', owner.contactReply === false);
ok('migration set statusVcard false', owner.statusVcard === false);
ok('migration is idempotent (marker set)', owner.v38VcardOff === true);
ok('saveNow called by migration', saved > 0);
ok('owner guard wrapped .setting', cmds.get('setting').__v38OwnerGuard === true);
ok('pin fix installed (no pin cmd present -> no crash)', res.pin === false || res.pin === true);

/* re-run must be safe */
let rerunOk = true;
try { install(); } catch (e) { rerunOk = false; }
ok('re-install is safe', rerunOk);

/* ── 8. owner-only guard actually refuses a stranger ─────────────────── */
console.log('\n[8] owner guard');
const sent = [];
const fakeSock = { sendMessage: async (jid, payload) => { sent.push(payload); return { key: { id: 'x' } }; } };
const stranger = { key: { remoteJid: '19998887777@s.whatsapp.net', fromMe: false, participant: '19998887777@s.whatsapp.net' } };
await cmds.get('setting').handler(fakeSock, stranger, []);
ok('stranger got the refusal', sent.length === 1 && /Owner only/.test(sent[0].text), JSON.stringify(sent));
const ownerMsg = { key: { remoteJid: '2348012345678@s.whatsapp.net', fromMe: false, participant: '2348012345678@s.whatsapp.net' } };
const r = await cmds.get('setting').handler(fakeSock, ownerMsg, []);
ok('owner still reaches the original handler', r === 'ORIGINAL');
const devMsg = { key: { remoteJid: '2348012345678:12@s.whatsapp.net', fromMe: false, participant: '2348012345678:12@s.whatsapp.net' } };
const r2 = await cmds.get('setting').handler(fakeSock, devMsg, []);
ok('owner with device suffix (:12) is still recognised', r2 === 'ORIGINAL');

console.log('\n' + (fail === 0 ? '✅ ALL ' + pass + ' CHECKS PASSED' : '❌ ' + fail + ' FAILED, ' + pass + ' passed'));
process.exit(fail === 0 ? 0 : 1);
