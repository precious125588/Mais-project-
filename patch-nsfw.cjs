#!/usr/bin/env node
/**
 * patch-nsfw.cjs — applies the NSFW/adult + play/chatbot/aio fixes IN PLACE.
 * No new "fix pack" file: it edits mias/index.js and mias/lib/autoDownloader.js.
 * Every replacement is anchored on text that was verified in the repo, and the
 * script FAILS LOUDLY if an anchor is missing instead of silently skipping.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const IDX = path.join(ROOT, 'mias', 'index.js');
const AUTO = path.join(ROOT, 'mias', 'lib', 'autoDownloader.js');

let idx = fs.readFileSync(IDX, 'utf8');
let auto = fs.readFileSync(AUTO, 'utf8');
const report = [];
function sub(file, from, to, label, required = true) {
  if (file === 'idx') {
    if (!idx.includes(from)) { report.push(`${required ? '❌' : '⚠️ '} ${label}: anchor not found`); return false; }
    idx = idx.split(from).join(to);
    report.push(`✅ ${label}`);
    return true;
  }
  if (!auto.includes(from)) { report.push(`${required ? '❌' : '⚠️ '} ${label}: anchor not found`); return false; }
  auto = auto.split(from).join(to);
  report.push(`✅ ${label}`);
  return true;
}

/* ── 1. 18+ warning on the Adult Mode toggle (settings 23.1 / 23.2) ───────── */
sub('idx',
  '  "23.1": s => { s.adultDl = true; s.adultMode = true; return "✅ Adult Mode: ON"; },',
  '  "23.1": s => { s.adultDl = true; s.adultMode = true; return "✅ Adult Mode: ON\\n\\n" +\n' +
  '    "🔞 *18+ WARNING*\\n" +\n' +
  '    "This feature is strictly for adults (18 years and older).\\n\\n" +\n' +
  '    "If you are *not 18 or older*, you are NOT allowed to use this feature — turn it back OFF now (*23.2*).\\n\\n" +\n' +
  '    "_By keeping this enabled you confirm you are 18+. Adult commands are now available._"; },',
  'adult toggle 23.1 warning');

sub('idx',
  '  "23.2": s => { s.adultDl = false; s.adultMode = false; return "❌ Adult Mode: OFF"; },',
  '  "23.2": s => { s.adultDl = false; s.adultMode = false; return "❌ Adult Mode: OFF\\n\\n_All adult commands are now disabled and hidden from the menu._"; },',
  'adult toggle 23.2 text');

/* show the 18+ note inline in the settings card too */
sub('idx',
  '┃ 23.1 ᴇɴᴀʙʟᴇ  ${s.adultMode ? "✅" : ""}',
  '┃ 23.1 ᴇɴᴀʙʟᴇ  ${s.adultMode ? "✅" : ""}   🔞 18+ ONLY',
  'adult toggle menu label', false);

/* ── 2. chatbot auto-reply engine: also answer in self-chat + log ─────────── */
const cbRe = /const _cbOn = !!\([^\n]*\);/;
if (cbRe.test(idx)) {
  idx = idx.replace(cbRe,
    'const _cbOn = !!(_cbChatS?.autoReply || _cbChatS?.chatBotMode || _cbOwnerS?.chatBotMode || _cbOwnerS?.autoReply);\n' +
    '              const _cbSelf = !!msg.key?.fromMe;');
  report.push('✅ chatbot engine: fromMe detection added');
  const cbRe2 = /const _cbScope = String\(_cbOwnerS\?\.chatbotScope \|\| "all"\)\.toLowerCase\(\);/;
  if (cbRe2.test(idx)) {
    idx = idx.replace(cbRe2,
      'const _cbScope = String(_cbOwnerS?.chatbotScope || "all").toLowerCase();\n' +
      '              const _cbScopeOk = _cbSelf ? true : (_cbScope === "all" || (_cbScope === "dm" && !String(msg.key?.remoteJid || "").endsWith("@g.us")) || (_cbScope === "group" && String(msg.key?.remoteJid || "").endsWith("@g.us")));');
    report.push('✅ chatbot engine: scope check made self-chat aware');
  } else {
    report.push('⚠️  chatbot scope anchor not found (non-blocking)');
  }
} else {
  report.push('⚠️  chatbot _cbOn anchor not found (non-blocking)');
}

/* ── 3. NSFW category in MENU_CATEGORIES ──────────────────────────────────── */
sub('idx',
  '{ name: "NSFW",      emoji: "🔞", cmds: ["r34","r34info","rule34home","rule34detail"], adult: true },',
  '{ name: "NSFW",      emoji: "🔞", adult: true, cmds: ["anal","ass","bdsm","blacknsfw","boobs","bottomless","collared18","cum","cumsluts","dick","domination","dp18","easter18","extreme18","feet18","finger18","fuck","futa","gay18","hentaigif","group18","hanime","hentaisfm","kiss18","lick18","pegged","phgif","puffies","pussy","real18","sixtynine","suck18","tattoo18","tiny18","toys18","xmas18","xvideossearch","xnxxsearch","xvideosdl","xnxxdl","adult","pornmaster","pornmasterv6","pornmasterv7"] },',
  'NSFW menu category', false);

/* ── 4. boot block at the very bottom of index.js ─────────────────────────── */
const BOOT = `
/* ══════════════════════════════════════════════════════════════════════════
   NSFW / ADULT PACK — Prexzy APIs + David Cyril APIs
   ONE module (mias/lib/nsfwAdultPack.js) + ONE data module
   (mias/lib/nsfwPrexzy.js). This is NOT a new fix pack: it registers through
   the same cmd() the bot already uses, purges the legacy adult commands, and
   re-registers .play / .ai / .aio with handlers that can never go silent.
   ══════════════════════════════════════════════════════════════════════════ */
try {
  require('./mias/lib/nsfwAdultPack.cjs').boot({
    commands: commands,
    cmd: cmd,
    sendReply: (typeof sendReply === 'function' ? sendReply : null),
    react: (typeof react === 'function' ? react : null),
    getSettings: (typeof getSettings === 'function' ? getSettings : null),
    getOwnerJid: (typeof getOwnerJid === 'function' ? getOwnerJid : null),
    CONFIG: (typeof CONFIG !== 'undefined' ? CONFIG : { PREFIX: '.' }),
    MENU_CATEGORIES: (typeof MENU_CATEGORIES !== 'undefined' ? MENU_CATEGORIES : null),
  });
} catch (__nsfwErr) {
  console.log('[nsfw-pack] boot error:', (__nsfwErr && __nsfwErr.message) || __nsfwErr);
}
/* __NSFW_ADULT_PACK__ */
`;
if (!idx.includes('__NSFW_ADULT_PACK__')) {
  idx = idx.replace(/\s*$/, '\n') + BOOT;
  report.push('✅ index.js boot block appended');
} else {
  report.push('⚠️  boot block already present');
}

/* ── 5. autoDownloader: adult branch goes to Prexzy NSFW first ────────────── */
const AUTO_PATCH = `
/* ══════════════════════════════════════════════════════════════════════════
   ADULT PATH (Prexzy /nsfw/xvideos-dl + /nsfw/xnxx-dl — VERIFIED live)
   Wraps the module-scope resolver so adult links never fall through to the
   generic provider that returned "an error page instead of media".
   ══════════════════════════════════════════════════════════════════════════ */
try {
  const __nsfw = require('./mias/lib/nsfwPrexzy.cjs');
  if (typeof resolvePlatformMedia === 'function' && !globalThis.__NSFW_AUTODL_PATCHED__) {
    globalThis.__NSFW_AUTODL_PATCHED__ = true;
    const __origResolve = resolvePlatformMedia;
    resolvePlatformMedia = async function (url, platform) {
      if (platform === 'adult' || /xvideos\\.|xnxx\\./i.test(String(url))) {
        const eps = /xnxx\\./i.test(String(url))
          ? ['/nsfw/xnxx-dl', '/nsfw/xvideos-dl', '/download/aio']
          : ['/nsfw/xvideos-dl', '/nsfw/xnxx-dl', '/download/aio'];
        for (const ep of eps) {
          try {
            const r = await __nsfw.prexzyJson(ep, { url }, 45000);
            if (!r.ok) continue;
            const u = __nsfw.pickUrl(r.data);
            if (u) return { url: u, type: 'video', title: r.data?.title || 'Adult', _via: 'prexzy' + ep };
          } catch {}
        }
        console.log('[nsfw-adult] all Prexzy adult providers missed, falling back to generic resolver');
      }
      return __origResolve.apply(this, arguments);
    };
    console.log('[nsfw-adult] ✅ autoDownloader adult path -> Prexzy /nsfw/xvideos-dl + /nsfw/xnxx-dl');
  }
} catch (e) {
  console.log('[nsfw-adult] autoDownloader patch failed:', (e && e.message) || e);
}
/* __NSFW_ADULT_PACK__ */
`;
if (!auto.includes('__NSFW_ADULT_PACK__')) {
  auto = auto.replace(/\s*$/, '\n') + AUTO_PATCH;
  report.push('✅ autoDownloader.js adult path appended');
} else {
  report.push('⚠️  autoDownloader.js already patched');
}

fs.writeFileSync(IDX, idx);
fs.writeFileSync(AUTO, auto);

console.log(report.join('\n'));
const failed = report.filter(r => r.startsWith('❌'));
if (failed.length) { console.error('\nFAILED anchors:\n' + failed.join('\n')); process.exit(1); }
console.log('\nPatch complete.');
