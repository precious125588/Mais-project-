// Verification: heavy-task guard, welcome/goodbye username cards,
// creator-page status, sudo-quote wiring, listener safety.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); } }

(async () => {
  console.log('\n== 1. Heavy-task guard: bounded concurrency ==');
  const heavy = require('../mias/lib/heavyTaskGuard.cjs');
  let inflight = 0, maxInflight = 0;
  const tasks = [];
  for (let i = 0; i < 6; i++) {
    tasks.push(heavy.runHeavy(async () => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise(r => setTimeout(r, 40));
      inflight--;
      return i;
    }, { tag: 't' + i }));
  }
  const results = await Promise.all(tasks);
  ok(results.length === 6, 'all 6 tasks completed');
  ok(maxInflight <= heavy.CONCURRENCY, `concurrency bounded (max inflight=${maxInflight}, limit=${heavy.CONCURRENCY})`);

  console.log('\n== 2. Heavy-task guard: failure is safe, process alive ==');
  let failed = null;
  try { await heavy.runHeavy(async () => { throw new Error('boom'); }, { tag: 'fail' }); } catch (e) { failed = e; }
  ok(!!failed && failed.message === 'boom', 'failed task rejects with reason');
  const s1 = heavy.stats();
  ok(s1.failed >= 1, 'failure counted in stats');

  console.log('\n== 3. Heavy-task guard: timeout + temp cleanup ==');
  const tmpDir = path.join(os.tmpdir(), 'p2-dl');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpF = path.join(tmpDir, 'dl_testcleanup_' + Date.now());
  fs.writeFileSync(tmpF, 'x');
  let timedOut = false;
  try {
    await heavy.runHeavy(() => new Promise(() => {}), { tag: 'hang', timeoutMs: 300, cleanup: [tmpF] });
  } catch (e) { timedOut = e && e.message === 'timeout'; }
  ok(timedOut, 'hung task times out instead of blocking forever');
  ok(!fs.existsSync(tmpF), 'temp file cleaned after timeout');

  console.log('\n== 4. Welcome/goodbye cards: username rendered inside image ==');
  const { renderMemberCard } = require('../mias/lib/welcomeCards.cjs');
  const longName = 'NarutoFan_うずまき 🔥🍥 ' + 'x'.repeat(120);
  const card1 = await renderMemberCard(null, 'WELCOME', longName, 'Anime Hub • Member #42');
  ok(Buffer.isBuffer(card1) && card1.length > 3000, 'welcome card renders with long Unicode/emoji name + fallback avatar');
  ok(card1[0] === 0xFF && card1[1] === 0xD8, 'card is a valid JPEG');
  const card2 = await renderMemberCard(null, 'GOODBYE', '', 'Anime Hub');
  ok(Buffer.isBuffer(card2) && card2.length > 3000, 'goodbye card renders with empty name → safe fallback');
  // with a real avatar buffer (generated 64x64 red square via Jimp)
  const Jimp = require('jimp');
  const avBuf = await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_JPEG);
  const card3 = await renderMemberCard(avBuf, 'WELCOME', 'Sasuke_Uchiha', 'Leaf Village • Member #7');
  ok(Buffer.isBuffer(card3) && card3.length > 3000, 'card renders with real profile image');

  console.log('\n== 5. Creator page status (existing config, no invented username) ==');
  delete process.env.CREATOR_USERNAME; delete process.env.OWNER_NAME;
  delete process.env.REPL_OWNER; delete process.env.OWNER_NUMBER;
  const CPS = require('../mias/lib/creatorPageStatus.cjs');
  let st = CPS.status();
  ok(!st.configured && st.state === 'INACTIVE', 'unset → NOT CONFIGURED / INACTIVE');
  process.env.OWNER_NAME = 'PreciousTest';
  st = CPS.status();
  ok(st.configured && st.active && st.username === 'PreciousTest', 'existing OWNER_NAME → ACTIVE with real value');
  ok(CPS.statusLines().join('\n').includes('👤 CREATOR PAGE'), 'status block has CREATOR PAGE header');
  delete process.env.OWNER_NAME;

  console.log('\n== 6. Static wiring: sudo-quote, welcome username, heavy guard, listeners ==');
  const idx = fs.readFileSync(path.join(__dirname, '..', 'mias', 'index.js'), 'utf8');
  ok(idx.includes('renderMemberCard(_wPp, "WELCOME", display'), 'welcome card receives target member display name');
  ok(idx.includes('renderMemberCard(_gPp, "GOODBYE", display'), 'goodbye card receives departing member display name');
  ok(idx.includes("[SUDO-QUOTE] reply detected"), 'sudo quote diagnostics present in index.js');
  ok(/imageMessage\?\.caption/.test(idx), 'sudo handler falls back to quoted imageMessage caption');
  const v24 = fs.readFileSync(path.join(__dirname, '..', 'mias', 'precious-fixes-v24.cjs'), 'utf8');
  ok(v24.includes('[SUDO-QUOTE] handler matched'), 'v24 picker sudo diagnostics present');
  const anime = fs.readFileSync(path.join(__dirname, '..', 'mias', 'precious-anime-edits.cjs'), 'utf8');
  ok(anime.includes('heavyTaskGuard'), 'anime edit downloads bounded by heavy-task guard');
  const boot = fs.readFileSync(path.join(__dirname, '..', 'precious-master-fix-boot.cjs'), 'utf8');
  ok(boot.includes('heavyTaskGuard.cjs') && boot.includes('creatorPageStatus.cjs'), 'boot prints heavy-task + creator-page status');
  const gpCount = (idx.match(/sock\.ev\.on\("group-participants\.update"/g) || []).length;
  ok(gpCount <= 2, `welcome/goodbye listeners attach at socket creation, not per reconnect (count=${gpCount})`);

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
