import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installSplitVideo, pickVideoSource, findVideoIn } from '../mias/features/splitVideo.js';
import { resolveFfmpeg } from '../mias/lib/videoTools.js';

const FF = resolveFfmpeg();
let hasFfmpeg = true;
try { execFileSync(FF, ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }
const skip = hasFfmpeg ? false : 'ffmpeg not installed';

test('findVideoIn: plain video, video document, and wrapped view-once video', () => {
  assert.equal(findVideoIn({ videoMessage: { seconds: 5 } })?.dlType, 'video');
  assert.equal(findVideoIn({ documentMessage: { mimetype: 'video/x-matroska', fileName: 'a.mkv' } })?.ext, 'mkv');
  assert.equal(findVideoIn({ documentMessage: { mimetype: 'application/pdf', fileName: 'a.pdf' } }), null);
  assert.equal(findVideoIn({ viewOnceMessageV2: { message: { videoMessage: {} } } })?.dlType, 'video');
  assert.equal(findVideoIn({ imageMessage: {} }), null);
});

test('pickVideoSource: prefers the quoted video over the command message', () => {
  const msg = { message: { extendedTextMessage: { text: '.split', contextInfo: { quotedMessage: { videoMessage: {} } } } } };
  assert.equal(pickVideoSource(msg)?.dlType, 'video');
  const direct = { message: { videoMessage: { caption: '.split' } } };
  assert.equal(pickVideoSource(direct)?.dlType, 'video');
  assert.equal(pickVideoSource({ message: { conversation: '.split' } }), null);
});

function makeFakeCmd() {
  const handlers = {};
  const cmd = (names, _opts, fn) => { for (const n of names) handlers[n] = fn; };
  return { cmd, handlers };
}

function makeSock() {
  const sent = [];
  return {
    sent,
    sock: { sendMessage: async (jid, content) => { sent.push(content); return {}; } },
  };
}

function makeClip(seconds, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-'));
  const out = path.join(dir, name);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=320x240:rate=25`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { stdio: 'ignore' });
  return out;
}

const streamFrom = (file) => (async function* () { yield fs.readFileSync(file); })();

test('.split: a 200 second video is sent as three MP4 parts', { skip }, async () => {
  const clip = makeClip(200, 'long.mp4');
  const { cmd, handlers } = makeFakeCmd();
  const reacts = [];
  installSplitVideo({
    cmd, CONFIG: { PREFIX: '.' },
    sendReply: async (_s, _m, text) => { reacts.push(text); },
    react: async (_s, _m, e) => { reacts.push(e); },
    downloadContentFromMessage: async () => streamFrom(clip),
  });
  const { sock, sent } = makeSock();
  const msg = { key: { remoteJid: 'g@g.us' }, message: { extendedTextMessage: { text: '.split', contextInfo: { quotedMessage: { videoMessage: {} } } } } };
  await handlers['split'](sock, msg);
  const videos = sent.filter((c) => c.video);
  assert.equal(videos.length, 3, `parts sent: ${videos.length}, reacts: ${reacts.join(' ')}`);
  assert.ok(reacts.includes('✅'));
});

test('.split: a video of 90 seconds or less gets the limit message', { skip }, async () => {
  const clip = makeClip(30, 'short.mp4');
  const { cmd, handlers } = makeFakeCmd();
  const texts = [];
  installSplitVideo({
    cmd, CONFIG: { PREFIX: '.' },
    sendReply: async (_s, _m, text) => { texts.push(text); },
    react: async () => {},
    downloadContentFromMessage: async () => streamFrom(clip),
  });
  const { sock, sent } = makeSock();
  const msg = { key: { remoteJid: 'g@g.us' }, message: { extendedTextMessage: { text: '.split', contextInfo: { quotedMessage: { videoMessage: {} } } } } };
  await handlers['split'](sock, msg);
  assert.equal(sent.filter((c) => c.video || c.document).length, 0);
  assert.ok(texts.some((t) => /split limit is 90 seconds/.test(t)), texts.join(' | '));
});

test('.remux: an MKV video is sent back as MP4', { skip }, async () => {
  const mp4 = makeClip(10, 'r.mp4');
  const mkv = path.join(path.dirname(mp4), 'r.mkv');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', mp4, '-c', 'copy', mkv], { stdio: 'ignore' });
  const { cmd, handlers } = makeFakeCmd();
  installSplitVideo({
    cmd, CONFIG: { PREFIX: '.' },
    sendReply: async () => {}, react: async () => {},
    downloadContentFromMessage: async () => streamFrom(mkv),
  });
  const { sock, sent } = makeSock();
  const msg = { key: { remoteJid: 'g@g.us' }, message: { extendedTextMessage: { text: '.remux', contextInfo: { quotedMessage: { documentMessage: { mimetype: 'video/x-matroska', fileName: 'r.mkv' } } } } } };
  await handlers['remux'](sock, msg);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].video);
  assert.equal(sent[0].video.subarray(4, 8).toString(), 'ftyp');
});
