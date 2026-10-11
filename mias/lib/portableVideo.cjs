'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

let ffmpegPath;
function resolveFfmpeg() {
  if (ffmpegPath) return ffmpegPath;
  try {
    let p = require('ffmpeg-static');
    if (p && typeof p === 'object' && p.default) p = p.default;
    if (p && typeof p === 'string' && fs.existsSync(p)) {
      try { fs.chmodSync(p, 0o755); } catch (_) {}
      ffmpegPath = p;
      return ffmpegPath;
    }
  } catch (_) {}
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    ffmpegPath = process.env.FFMPEG_PATH;
    return ffmpegPath;
  }
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/bin/ffmpeg']) {
    if (fs.existsSync(p)) {
      ffmpegPath = p;
      return ffmpegPath;
    }
  }
  ffmpegPath = 'ffmpeg';
  return ffmpegPath;
}

function isMp4(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp';
}

async function normalizeVideoBuffer(input, opts = {}) {
  if (!Buffer.isBuffer(input) || input.length < 1024) return input;
  if (input.length > (opts.maxInputBytes || 120 * 1024 * 1024)) return input;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mias-video-'));
  const inPath = path.join(dir, 'input.bin');
  const outPath = path.join(dir, 'output.mp4');
  try {
    await fsp.writeFile(inPath, input);
    const bin = resolveFfmpeg();

    // 1) Fast path: stream copy with faststart (instant, no CPU transcode, fixes WhatsApp moov atom)
    try {
      await execFileAsync(bin, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', inPath,
        '-c', 'copy', '-movflags', '+faststart',
        '-f', 'mp4', outPath,
      ], { timeout: 30000, maxBuffer: opts.maxBuffer || 16 * 1024 * 1024 });
      const fastOutput = await fsp.readFile(outPath);
      if (isMp4(fastOutput) && fastOutput.length > 10000) return fastOutput;
    } catch (_) {
      // Stream copy failed or input needs re-encode; continue to full transcode
    }

    // 2) Full transcode fallback with faststart
    await execFileAsync(bin, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', inPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', opts.preset || 'veryfast',
      '-crf', String(opts.crf || 26), '-pix_fmt', 'yuv420p',
      ...(opts.maxrate ? ['-maxrate', String(opts.maxrate), '-bufsize', String(opts.bufsize || opts.maxrate)] : []),
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      '-f', 'mp4', outPath,
    ], { timeout: opts.timeoutMs || 120000, maxBuffer: opts.maxBuffer || 32 * 1024 * 1024 });
    const output = await fsp.readFile(outPath);
    if (isMp4(output) && output.length > 10000) return output;
  } catch (err) {
    try { console.warn('[video] normalization skipped:', err && err.message || err); } catch (_) {}
  } finally {
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
  }
  return input;
}

module.exports = { normalizeVideoBuffer, isMp4, resolveFfmpeg };
