'use strict';
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
let ffmpegPath;
function resolveFfmpeg() {
  if (ffmpegPath) return ffmpegPath;
  try { ffmpegPath = require('ffmpeg-static'); }
  catch (_) { ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'; }
  return ffmpegPath;
}
function isMp4(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp';
}
async function normalizeVideoBuffer(input, opts = {}) {
  if (!Buffer.isBuffer(input) || input.length < 1024) return input;
  if (input.length > (opts.maxInputBytes || 90 * 1024 * 1024)) return input;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mias-video-'));
  const inPath = path.join(dir, 'input.bin');
  const outPath = path.join(dir, 'output.mp4');
  try {
    await fsp.writeFile(inPath, input);
    await execFileAsync(resolveFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', inPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', opts.preset || 'veryfast',
      '-crf', String(opts.crf || 23), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      '-f', 'mp4', outPath,
    ], { timeout: opts.timeoutMs || 120000, maxBuffer: 1024 * 1024 });
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
