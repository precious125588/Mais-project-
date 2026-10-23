import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const media = require('../mias/lib/providerMedia.cjs');

test('Prexzy parser accepts the current top-level download_url shape', () => {
  const picked = media.pickPrexzyVideo({ status: true, download_url: 'https://cdn.example/video.mp4', info: { title: 'sample' } });
  assert.deepEqual(picked, { url: 'https://cdn.example/video.mp4', title: 'sample' });
  assert.equal(media.pickPrexzyVideo({ status: false, message: 'error page' }), null);
});

test('NexRay parser selects a real muxed video and avoids the source page URL', () => {
  const parsed = media.pickNexrayVideo({
    result: {
      url: 'https://youtube.com/watch?v=abcdefghijk', title: 'sample',
      medias: [
        { type: 'video', height: 2160, ext: 'mp4', url: 'https://cdn.example/2160.mp4' },
        { type: 'video', height: 360, ext: 'mp4', is_audio: true, url: 'https://cdn.example/360.mp4' },
      ],
    },
  });
  assert.equal(parsed.url, 'https://cdn.example/360.mp4');
  assert.equal(parsed.hasAudio, true);
  assert.equal(parsed.height, 360);
  assert.equal(media.pickNexrayVideo({ result: { url: 'https://youtube.com/watch?v=abcdefghijk' } }), null);
});

test('provider URL validation rejects non-http schemes and credentials', () => {
  assert.equal(media.isHttpUrl('https://cdn.example/file.mp4'), true);
  assert.equal(media.isHttpUrl('javascript:alert(1)'), false);
  assert.equal(media.isHttpUrl('https://user:pass@cdn.example/a'), false);
});

test('bot routes share provider parsing, preserves all commands and temp cleanup', () => {
  const auto = fs.readFileSync(path.join(ROOT, 'mias/lib/autoDownloader.js'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'mias/index.js'), 'utf8');
  const reliable = fs.readFileSync(path.join(ROOT, 'lib/reliableDl.js'), 'utf8');
  assert.match(auto, /name: "nexray-aio"/);
  assert.match(auto, /pickNexrayVideo/);
  assert.match(auto, /finally \{\s*cleanupTemp\(tmpPath\);/);
  assert.match(index, /cmd\(\["aio","alldl","universaldl"\]/);
  assert.match(index, /cmd\(\["video","yt","ytdl"/);
  assert.match(index, /pickPrexzyVideo/);
  assert.match(reliable, /pickNexrayVideo/);
});

test('last-seen commands can display only previously observed saved timestamps', () => {
  const index = fs.readFileSync(path.join(ROOT, 'mias/index.js'), 'utf8');
  assert.match(index, /lastSeenRecords\?\.\[String\(targetJid\)\.toLowerCase\(\)\]/);
  assert.match(index, /lastSeenEnabled: false, lastSeenFrozen: false, lastSeenRecords: \{\}/);
  assert.match(index, /Only presence events this connection can actually observe are saved/);
});
