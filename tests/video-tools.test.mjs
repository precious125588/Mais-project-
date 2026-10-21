import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  probeFile, splitVideoFile, remuxToMp4, convertToMp4, splitPlan, fmtDuration, parseProbe, resolveFfmpeg, SPLIT_SECONDS,
} from '../mias/lib/videoTools.js';

const FF = resolveFfmpeg();
let hasFfmpeg = true;
try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }
const skip = hasFfmpeg ? false : 'ffmpeg not installed in this environment';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'));
function makeClip(name, seconds, ext = 'mp4') {
  const out = path.join(tmp, name);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=320x240:rate=25`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { stdio: 'ignore' });
  return out;
}

test('splitPlan: videos of 90 seconds or less are not split', () => {
  assert.deepEqual(splitPlan(45), { needed: false, parts: 1 });
  assert.deepEqual(splitPlan(90), { needed: false, parts: 1 });
  assert.equal(SPLIT_SECONDS, 90);
});

test('splitPlan: longer videos are split into 90 second parts', () => {
  assert.deepEqual(splitPlan(91), { needed: true, parts: 2 });
  assert.deepEqual(splitPlan(200), { needed: true, parts: 3 });
  assert.deepEqual(splitPlan(270), { needed: true, parts: 3 });
});

test('fmtDuration and parseProbe read ffmpeg stream reports', () => {
  assert.equal(fmtDuration(200), '3m 20s');
  assert.equal(fmtDuration(45), '45s');
  const info = parseProbe('  Duration: 00:03:20.04, start: 0.0\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1), yuv420p, 320x240\n  Stream #0:1: Audio: aac (LC), 44100 Hz');
  assert.ok(Math.abs(info.duration - 200.04) < 0.01);
  assert.equal(info.videoCodec, 'h264');
  assert.equal(info.audioCodec, 'aac');
});

test('split: a 200 second video becomes 90 + 90 + 20 second MP4 parts with stream copy', { skip }, async () => {
  const src = makeClip('long.mp4', 200);
  const info = await probeFile(src);
  assert.ok(Math.abs(info.duration - 200) < 1, `duration ${info.duration}`);
  const dir = fs.mkdtempSync(path.join(tmp, 'split-'));
  const t0 = Date.now();
  const parts = await splitVideoFile(src, dir, info);
  const ms = Date.now() - t0;
  assert.equal(parts.length, 3, `expected 3 parts, got ${parts.length}`);
  let total = 0;
  for (const p of parts) {
    const d = (await probeFile(p)).duration;
    total += d;
    assert.ok(d <= SPLIT_SECONDS + 3, `part is ${d}s, should be about 90s (keyframe tolerance)`);
    assert.ok(/\.mp4$/.test(p));
  }
  assert.ok(Math.abs(total - 200) < 1.5, `total ${total}`);
  assert.ok(ms < 20000, `split took ${ms}ms`);
  console.log(`[split] 200s source -> ${parts.length} parts in ${ms}ms`);
});

test('split: an MKV source is split into MP4 parts', { skip }, async () => {
  const src = makeClip('short-src.mkv', 100, 'mkv');
  const mkv = path.join(tmp, 'src100.mkv');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', src, '-c', 'copy', mkv], { stdio: 'ignore' });
  const info = await probeFile(mkv);
  const dir = fs.mkdtempSync(path.join(tmp, 'mkv-'));
  const parts = await splitVideoFile(mkv, dir, info);
  assert.equal(parts.length, 2);
  for (const p of parts) assert.ok(/\.mp4$/.test(p));
});

test('remux: MKV becomes MP4 with the H.264 stream copied (no re-encode)', { skip }, async () => {
  const src = makeClip('remux-src.mp4', 10);
  const mkv = path.join(tmp, 'r10.mkv');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', src, '-c', 'copy', mkv], { stdio: 'ignore' });
  const info = await probeFile(mkv);
  const out = path.join(tmp, 'r10-out.mp4');
  const t0 = Date.now();
  await remuxToMp4(mkv, out, info);
  const ms = Date.now() - t0;
  const after = await probeFile(out);
  assert.equal(after.videoCodec, 'h264');
  assert.ok(Math.abs(after.duration - 10) < 0.5);
  assert.ok(ms < 10000, `remux took ${ms}ms`);
});

test('tomp4: an H.264 video converts to MP4 quickly by stream copy', { skip }, async () => {
  const src = makeClip('tomp4-src.mp4', 60);
  const out = path.join(tmp, 'tomp4-out.mp4');
  const t0 = Date.now();
  const res = await convertToMp4(src, out, { kind: 'video' });
  const ms = Date.now() - t0;
  assert.equal(res.ok, true, res.error);
  assert.ok(ms < 15000, `tomp4 took ${ms}ms`);
  console.log(`[tomp4] 60s H.264 clip converted in ${ms}ms (stream copy)`);
});

test('tomp4: a non-H.264 input is re-encoded to MP4 and completes', { skip }, async () => {
  const mpg = path.join(tmp, 'x8.mpg');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=320x240:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'mpeg2video', '-c:a', 'mp2', mpg], { stdio: 'ignore' });
  const out = path.join(tmp, 'x8-out.mp4');
  const res = await convertToMp4(mpg, out, { kind: 'video' });
  assert.equal(res.ok, true, res.error);
  const after = await probeFile(out);
  assert.equal(after.videoCodec, 'h264');
});

test('tomp4: a broken file returns an error instead of hanging', { skip }, async () => {
  const bad = path.join(tmp, 'bad.mp4');
  fs.writeFileSync(bad, 'not a video at all');
  const res = await convertToMp4(bad, path.join(tmp, 'bad-out.mp4'), { kind: 'video', timeoutMs: 20000 });
  assert.equal(res.ok, false);
  assert.ok(res.error.length > 0);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
