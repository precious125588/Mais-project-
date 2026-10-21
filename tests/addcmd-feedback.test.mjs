import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'mias/index.js'), 'utf8');
const start = source.indexOf('// ── addcmd / editcmd / savecmd — save a new command to disk');
const end = source.indexOf('// ── run / exec — JS eval with captured console output', start);
const block = source.slice(start, end);

test('addcmd uses reactions for progress/success and keeps errors concise', () => {
  assert.notEqual(start, -1, 'addcmd handler exists');
  assert.notEqual(end, -1, 'addcmd handler has a clear end marker');
  assert.match(block, /await react\(sock, msg, "🌀"\)/);
  assert.match(block, /await react\(sock, msg, "✅"\)/);
  assert.match(block, /await react\(sock, msg, "❌"\)/);
  assert.match(block, /Usage:/);
  assert.match(block, /Invalid JavaScript:/);
  assert.doesNotMatch(block, /Command "\$\{name\}" saved & live!/);
  assert.doesNotMatch(block, /await sendReply\(sock, msg,\s*`✅/);
});
