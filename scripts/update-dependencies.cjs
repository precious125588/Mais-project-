#!/usr/bin/env node
'use strict';
/**
 * Dependency updater for the bot workspaces (root and mias/).
 *
 *   node scripts/update-dependencies.cjs                      dry run: shows what would change
 *   node scripts/update-dependencies.cjs --apply              updates package.json, reinstalls, verifies, tests
 *   node scripts/update-dependencies.cjs --apply --major      also crosses major versions (holds still apply)
 *   node scripts/update-dependencies.cjs --apply --dir mias   one workspace only
 *   node scripts/update-dependencies.cjs --apply --no-test    skip the test suite
 *
 * Rules:
 *  - Only versions published at least `minAgeHours` ago are chosen (dependency-policy.json).
 *  - Without --major a dependency stays inside its current caret range (^1.2.3 -> 1.x, ^0.35.3 -> 0.35.x).
 *  - Packages in `hold` stay on their current major.
 *  - After --apply: install with legacy-peer-deps (same flag as the Dockerfile), check sharp and the
 *    sticker engine, syntax-check the entry files, re-apply the Baileys patch, run the test suite.
 *    Any failure restores package.json and the lockfile from a snapshot.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const MAJOR = args.includes('--major');
const SKIP_TESTS = args.includes('--no-test');
const dirArg = args.indexOf('--dir');
const ONLY = dirArg >= 0 ? args[dirArg + 1] : null;

const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'dependency-policy.json'), 'utf8'));
const MIN_AGE_MS = (policy.minAgeHours ?? 24) * 3600 * 1000;
const WORKSPACES = ['.', 'mias'].filter((d) => !ONLY || d === ONLY);

const log = (...a) => console.log('[deps]', ...a);
const run = (cmd, argv, cwd, opts = {}) =>
  spawnSync(cmd, argv, { cwd, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', maxBuffer: 64 * 1024 * 1024 });

function parseVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; // prereleases are skipped
}
const cmpVersion = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
const specFloor = (spec) => {
  const m = String(spec).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
function inCaret(v, floor) {
  if (!floor) return true;
  if (v[0] !== floor[0]) return false;
  if (floor[0] === 0 && v[1] !== floor[1]) return false;
  return cmpVersion(v, floor) >= 0;
}

// npm view <name> time --json -> { "<version>": "<publish time>", ... }
function publishTimes(name) {
  const r = run('npm', ['view', name, 'time', '--json'], ROOT, { quiet: true });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function pickTarget(name, currentSpec, major) {
  const times = publishTimes(name);
  if (!times) return { error: 'registry lookup failed' };
  const floor = specFloor(currentSpec);
  const cutoff = Date.now() - MIN_AGE_MS;
  let best = null;
  for (const [ver, t] of Object.entries(times)) {
    const v = parseVersion(ver);
    if (!v) continue;
    if (new Date(t).getTime() > cutoff) continue;          // too new for the release-age rule
    if (!major && !inCaret(v, floor)) continue;             // stay in range
    if (major && floor && v[0] < floor[0]) continue;
    if (!best || cmpVersion(v, best.v) > 0) best = { v, ver };
  }
  return best ? { version: best.ver } : { error: 'no version passes the age rule' };
}

function planWorkspace(dir) {
  const pkgPath = path.join(ROOT, dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const plan = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(pkg[section] || {})) {
      if (/^(file:|link:|git|https?:)/.test(spec)) { plan.push({ name, section, spec, skip: 'local or git source' }); continue; }
      if (spec.startsWith('npm:')) {
        const target = spec.slice(4);
        const base = target.lastIndexOf('@') > 0 ? target.slice(0, target.lastIndexOf('@')) : target;
        const t = pickTarget(base, '', true);
        plan.push({ name, section, spec, alias: base, aliasTarget: t, skip: 'alias (refreshed by npm install)' });
        continue;
      }
      if (policy.hold && policy.hold[name] && !MAJOR) { plan.push({ name, section, spec, skip: `held: ${policy.hold[name]}` }); continue; }
      const major = MAJOR && !(policy.hold && policy.hold[name]);
      const t = pickTarget(name, spec, major);
      if (t.error) { plan.push({ name, section, spec, skip: t.error }); continue; }
      const cur = specFloor(spec);
      const next = t.version;
      const same = cur && cmpVersion(cur, parseVersion(next)) === 0;
      plan.push({ name, section, spec, next: `^${next}`, changed: !same, skip: same ? 'already current' : null });
    }
  }
  return { pkgPath, pkg, plan };
}

function snapshot(dir) {
  const out = {};
  for (const f of ['package.json', 'package-lock.json']) {
    const p = path.join(ROOT, dir, f);
    out[f] = fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
  return out;
}
function restore(dir, snap) {
  for (const [f, buf] of Object.entries(snap)) {
    const p = path.join(ROOT, dir, f);
    if (buf === null) { try { fs.unlinkSync(p); } catch {} } else fs.writeFileSync(p, buf);
  }
}

// Aliased packages (for example @whiskeysockets/baileys -> @itsliaaa/baileys@latest) keep their
// lock entry until npm update refreshes them. Refresh only when the dist-tag is old enough.
function install(dir) {
  return run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--maxsockets', '4'], path.join(ROOT, dir));
}

function verify(dir) {
  const cwd = path.join(ROOT, dir);
  const problems = [];
  const nm = path.join(cwd, 'node_modules');
  if (!fs.existsSync(nm)) return ['node_modules missing after install'];

  // sharp loads and the sticker engine still produces a WEBP.
  if (fs.existsSync(path.join(nm, 'sharp'))) {
    const check = `
      const sharp = require('sharp');
      (async () => {
        const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
        if (!png.length) throw new Error('sharp produced no output');
        if (require('fs').existsSync('node_modules/wa-sticker-formatter')) {
          const { Sticker, StickerTypes } = require('wa-sticker-formatter');
          const out = await new Sticker(png, { pack: 'verify', author: 'verify', type: StickerTypes.FULL }).toBuffer();
          if (out.slice(8, 12).toString() !== 'WEBP') throw new Error('sticker engine did not return WEBP');
        }
        console.log('sharp ' + sharp.versions.sharp + ' OK');
      })().catch((e) => { console.error(e.message); process.exit(1); });`;
    const r = spawnSync(process.execPath, ['-e', check], { cwd, encoding: 'utf8' });
    if (r.status !== 0) problems.push(`sharp/sticker: ${(r.stderr || r.stdout).trim()}`);
    else log(`${dir}: ${r.stdout.trim()}`);
  }

  // A nested old sharp is what made installs hang (sharp 0.30 downloads binaries at install time).
  if (fs.existsSync(path.join(nm, 'wa-sticker-formatter', 'node_modules', 'sharp'))) {
    problems.push('a nested sharp copy is installed under wa-sticker-formatter (the override did not apply)');
  }

  // Syntax of the entry points.
  const entry = dir === 'mias'
    ? ['index.js', 'lib/engines/utilityEngine.cjs', 'lib/engines/fileDetection.cjs', 'lib/engines/queueEngine.cjs', 'lib/engines/linkPreview.cjs']
    : ['server.js', 'pair.js', 'bot.js'];
  for (const f of entry) {
    const p = path.join(cwd, f);
    if (!fs.existsSync(p)) continue;
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
    if (r.status !== 0) problems.push(`syntax ${f}: ${(r.stderr || '').split('\n').slice(0, 3).join(' ')}`);
  }

  // The Baileys patch must still apply (it is idempotent).
  if (dir === 'mias') {
    const r = run(process.execPath, [path.join(ROOT, 'scripts/patch-baileys.cjs')], ROOT, { quiet: true });
    if (r.status !== 0) problems.push('patch-baileys.cjs failed');
  }
  return problems;
}

function runTests() {
  if (SKIP_TESTS) return { skipped: true };
  const dir = path.join(ROOT, 'tests');
  const files = fs.readdirSync(dir).filter((f) => /\.test\.(mjs|cjs|js)$/.test(f)).map((f) => path.join('tests', f));
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: ROOT, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  const known = new Set(policy.knownTestFailures || []);
  return {
    total: (out.match(/^# tests (\d+)/m) || [])[1],
    pass: (out.match(/^# pass (\d+)/m) || [])[1],
    fail: (out.match(/^# fail (\d+)/m) || [])[1],
    newFailures: failed.filter((f) => !known.has(f)),
  };
}

// ── main ────────────────────────────────────────────────────────────────────
log(APPLY ? 'APPLY mode' : 'DRY RUN (add --apply to write changes)', MAJOR ? '(major versions allowed)' : '(caret ranges only)');
let anyFailed = false;
const summary = [];

for (const dir of WORKSPACES) {
  const { pkgPath, pkg, plan } = planWorkspace(dir);
  log(`\n== workspace: ${dir}`);
  for (const p of plan) {
    if (p.alias) { console.log(`  ${p.name.padEnd(30)} alias, latest publishable: ${p.aliasTarget.version || p.aliasTarget.error}`); continue; }
    if (!p.changed) { if (p.skip && p.skip !== 'already current') console.log(`  ${p.name.padEnd(30)} ${p.spec.padEnd(20)} ${p.skip}`); continue; }
    console.log(`  ${p.name.padEnd(30)} ${p.spec.padEnd(20)} -> ${p.next}`);
  }
  if (!APPLY) continue;

  const snap = snapshot(dir);
  let changed = 0;
  for (const p of plan) {
    if (!p.changed) continue;
    pkg[p.section][p.name] = p.next;
    changed++;
  }
  if (changed) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  for (const p of plan) {
    if (!p.alias) continue;
    const latest = run('npm', ['view', p.alias, 'dist-tags.latest', '--json'], ROOT, { quiet: true });
    const ver = latest.status === 0 ? JSON.parse(latest.stdout || '""') : null;
    const times = ver ? publishTimes(p.alias) : null;
    const ageOk = times && ver && new Date(times[ver]).getTime() <= Date.now() - MIN_AGE_MS;
    if (!ageOk) { log(`${dir}: ${p.name} latest (${ver || '?'}) is too new or unknown; keeping the locked version`); continue; }
    log(`${dir}: refreshing ${p.name} to ${p.alias}@${ver}`);
    run('npm', ['update', p.name, '--legacy-peer-deps', '--no-audit', '--no-fund'], path.join(ROOT, dir));
  }
  log(`${dir}: ${changed} specs updated; installing`);
  const inst = install(dir);
  if (inst.status !== 0) { log(`${dir}: install failed, restoring`); restore(dir, snap); anyFailed = true; continue; }
  const problems = verify(dir);
  if (problems.length) {
    log(`${dir}: verification failed, restoring package.json and lockfile:\n  - ${problems.join('\n  - ')}`);
    restore(dir, snap);
    run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], path.join(ROOT, dir), { quiet: true });
    anyFailed = true;
    continue;
  }
  summary.push(`${dir}: ${changed} updated and verified`);
}

if (APPLY && !anyFailed) {
  const t = runTests();
  if (t.skipped) log('tests skipped (--no-test)');
  else {
    log(`tests: ${t.pass} pass, ${t.fail} fail (of ${t.total})`);
    if (t.newFailures.length) {
      log('NEW test failures (not listed in dependency-policy.json knownTestFailures):\n  - ' + t.newFailures.join('\n  - '));
      anyFailed = true;
    }
  }
}
summary.forEach((s) => log(s));
process.exit(anyFailed ? 1 : 0);
