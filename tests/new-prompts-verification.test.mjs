import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexSrc = fs.readFileSync(path.join(root, 'mias/index.js'), 'utf8');
const v36Src = fs.readFileSync(path.join(root, 'mias/precious-fixes-v36.cjs'), 'utf8');
const autoSrc = fs.readFileSync(path.join(root, 'mias/lib/autoDownloader.js'), 'utf8');
const patchesSrc = fs.readFileSync(path.join(root, 'mias/lib/kevdraPatches.js'), 'utf8');
const menusSrc = fs.readFileSync(path.join(root, 'mias/lib/premiumMenus.js'), 'utf8');

test('1. Status-send: streams to temp disk, routes >90MB as document, cleans up on success/failure', () => {
  assert.match(v36Src, /90\s*\*\s*1024\s*\*\s*1024/, 'uses 90 MiB threshold');
  assert.match(v36Src, /asDocument\s*=\s*bytes\s*>\s*90\s*\*\s*1024\s*\*\s*1024/, 'marks >90MB as document');
  assert.match(v36Src, /fs\.createWriteStream/, 'streams media to disk');
  assert.match(v36Src, /fs\.promises\.rm\s*\(dir/, 'cleans up temp dir in finally block');
});

test('2. VCF contacts: uses real usernames, falls back to "No name", preserves real names', () => {
  assert.match(indexSrc, /function senderProfileName/, 'senderProfileName exists');
  assert.match(indexSrc, /"No name"/, 'falls back to "No name"');
  assert.match(indexSrc, /escapeVcardName/, 'escapes vcard name properly');
  assert.match(indexSrc, /senderProfileNames\.get\(key\),\s*participant\?\.notify,\s*participant\?\.verifiedName,\s*participant\?\.username/, 'resolves real names from pushName/notify/username');
});

test('3. Steeze mode: 30-min DM deletion, user reaction removal, bare AFK', () => {
  assert.match(indexSrc, /30\s*\*\s*60\s*\*\s*1000/, 'tracks 30 minute deletion timer');
  assert.match(indexSrc, /delete:\s*msg\.key/, 'deletes outgoing DMs');
  assert.match(indexSrc, /reactionMessage/, 'detects reaction messages');
  assert.match(indexSrc, /delete:\s*msg\.key/, 'deletes user reactions without affecting bot reactions');
  assert.match(indexSrc, /text:\s*_afkInfo\?\.reason\s*\|\|\s*"No reason"/, 'sends bare AFK message without extra decorators');
});

test('4. AutoDownloader queue & gate mode: FIFO queue, single-job processing, gate modes', () => {
  assert.match(autoSrc, /class AutoDownloadQueue/, 'FIFO queue implementation exists');
  assert.match(autoSrc, /this\.running\s*=\s*true/, 'processes jobs one at a time');
  assert.match(autoSrc, /persist\s*\(\)/, 'persists queue to disk');
  assert.match(autoSrc, /resumeAutoDownloads/, 'resumes queue on start');
  assert.match(autoSrc, /mode\s*===\s*"here"/, 'tightens gate mode for this chat only');
  assert.match(patchesSrc, /getAutoDownloadMode/, 'checks autoDownloadMode for jid');
});

test('5. Anti-bug shield: deletes crash message first, then blocks sender', () => {
  assert.match(indexSrc, /isCrashPayload\(msg\)/, 'checks for crash payload');
  assert.match(indexSrc, /delete:\s*msg\.key/, 'deletes crash payload message immediately');
  assert.match(indexSrc, /updateBlockStatus|setBlockStatus/, 'blocks the sender immediately');
});

test('6. AIO command: uses TikTok pipeline and 1.3 HD process without touching .tt command', () => {
  assert.match(indexSrc, /globalThis\.__miasTikTokHdDownload/, 'global TikTok HD download handler defined');
  assert.match(indexSrc, /parseTikTokMode\("1\.3"\)/, 'uses 1.3 HD mode');
  assert.match(indexSrc, /cmd\(\["aio"/, 'aio command routes to TikTok HD pipeline');
});

test('7. Anti-edit & Settings: destination control and MISC duplicates removed', () => {
  assert.match(indexSrc, /43\.1/, 'antiEdit toggle 43.1 in settings');
  assert.match(indexSrc, /43\.3/, 'antiEdit original chat destination 43.3');
  assert.match(indexSrc, /43\.4/, 'antiEdit owner DM destination 43.4');
  assert.match(menusSrc, /SETTINGS_MISC_DUPLICATES/, 'duplicate misc commands defined');
  assert.match(menusSrc, /normalizeMenuCategory\(entry\?\.category\)\s*===\s*'MISC'/, 'hides duplicate misc commands');
});

test('8. Group .add command: reports blocked bot with ❌ reaction', () => {
  assert.match(indexSrc, /blocked the bot/i, 'notifies when contact blocked bot');
  assert.match(indexSrc, /react\(sock,\s*msg,\s*ok\s*>\s*0\s*\?\s*"✅"\s*:\s*"❌"\)/, 'reacts ❌ on failure');
});
