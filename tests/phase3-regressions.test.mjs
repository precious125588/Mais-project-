import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── 1. Prefixless vv2 Aliases vs Prefixed vv2 ───────────────────────────────
test('prefixless vv2 aliases work raw while .vv2 remains prefixed', async () => {
  const { parseCommand } = await import('../mias/lib/prefix.cjs');

  // Prefixless aliases must trigger as command
  const rawAliases = ['lol', 'wow', 'hehe', '😂', '🙂', 'omor', 'chai', '🥀'];
  for (const alias of rawAliases) {
    const res = parseCommand(alias, '.');
    assert.equal(res.isCommand, true, `Alias "${alias}" should trigger prefixless`);
    assert.equal(res.command, alias);
  }

  // vv2 itself MUST NOT trigger prefixless
  const rawVv2 = parseCommand('vv2', '.');
  assert.equal(rawVv2.isCommand, false, 'Bare "vv2" must NOT trigger without prefix');

  // .vv2 must trigger with prefix
  const prefixedVv2 = parseCommand('.vv2', '.');
  assert.equal(prefixedVv2.isCommand, true, '".vv2" must trigger with prefix');
  assert.equal(prefixedVv2.command, 'vv2');

  // Prefixed aliases still work
  const prefixedLol = parseCommand('.lol', '.');
  assert.equal(prefixedLol.isCommand, true);
  assert.equal(prefixedLol.command, 'lol');

  // Random messages are not commands
  const regularMsg = parseCommand('Good morning everyone', '.');
  assert.equal(regularMsg.isCommand, false);
});

// ── 2. Device Detection Target and Quoted Resolution ─────────────────────────
test('device command: extracts target jid and detects device safely', async () => {
  const indexContent = fs.readFileSync(path.join(ROOT, 'mias', 'index.js'), 'utf8');

  // Verify device command handles quoted context, args, and message key
  assert.ok(indexContent.includes('cmd(["device","getdevice","checkdevice"]'));
  assert.ok(indexContent.includes('stanzaId = ctx?.stanzaId'));
  assert.ok(indexContent.includes('targetJid = toStandardJid'));
  assert.ok(indexContent.includes('const device = ["android", "ios", "web", "desktop"].includes(detected)'));
});

// ── 3. tovv Media Extraction and Fallbacks ───────────────────────────────────
test('tovv command: has viewOnceMessageV2 and safe buffer handling', async () => {
  const indexContent = fs.readFileSync(path.join(ROOT, 'mias', 'index.js'), 'utf8');

  assert.ok(indexContent.includes('cmd(["tovv"]'));
  assert.ok(indexContent.includes('viewOnceMessageV2'));
  assert.ok(indexContent.includes('generateWAMessageContent'));
});

// ── 4. Chatbot and AI Prexzy + Nexray Providers ──────────────────────────────
test('chatbot & AI commands: prioritize Prexzy and Nexray fallbacks', async () => {
  const indexContent = fs.readFileSync(path.join(ROOT, 'mias', 'index.js'), 'utf8');

  // Chatbot should have prexzy /ai/aichat and nexray /ai/gpt
  assert.ok(indexContent.includes('prexzyGet("/ai/aichat"'));
  assert.ok(indexContent.includes('api.nexray.eu.cc/ai/gpt'));

  // Main .gpt / .ai command should include Nexray fallback
  assert.ok(indexContent.includes('api.nexray.eu.cc/ai/gpt?prompt='));
});
