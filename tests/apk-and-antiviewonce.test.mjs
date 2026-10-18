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
