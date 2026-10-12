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

/**
 * Build a high quality slideshow video from an array of image URLs and an optional audio URL.
 * Slides each image for durationPerSlide seconds (default: 3 seconds).
 */
async function createSliderVideo({ images = [], audioUrl = null, durationPerSlide = 3 }) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('No images provided for slider video');
  }

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mias-slider-'));
  try {
    const downloadedImages = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const res = await fetch(images[i], {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 512) {
            const imgPath = path.join(dir, 'slide_' + String(i).padStart(3, '0') + '.jpg');
            await fsp.writeFile(imgPath, buf);
            downloadedImages.push(imgPath);
          }
        }
      } catch (e) {
        try { console.warn('[slider] image download failed for index', i, e?.message || e); } catch (_) {}
      }
    }

    if (downloadedImages.length === 0) {
      throw new Error('Failed to download any images for the slider video');
    }

    let audioPath = null;
    if (audioUrl) {
      try {
        const aRes = await fetch(audioUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(30000),
        });
        if (aRes.ok) {
          const aBuf = Buffer.from(await aRes.arrayBuffer());
          if (aBuf.length > 1024) {
            audioPath = path.join(dir, 'audio.bin');
            await fsp.writeFile(audioPath, aBuf);
          }
        }
      } catch (e) {
        try { console.warn('[slider] audio download failed:', e?.message || e); } catch (_) {}
      }
    }

    let concatText = '';
    for (let i = 0; i < downloadedImages.length; i++) {
      concatText += "file '" + downloadedImages[i] + "'\nduration " + durationPerSlide + "\n";
    }
    concatText += "file '" + downloadedImages[downloadedImages.length - 1] + "'\n";
    const concatFile = path.join(dir, 'concat.txt');
    await fsp.writeFile(concatFile, concatText);

    const outPath = path.join(dir, 'output.mp4');
    const totalDuration = String(downloadedImages.length * durationPerSlide);
    const bin = resolveFfmpeg();

    const ffmpegArgs = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', concatFile,
    ];

    if (audioPath) {
      ffmpegArgs.push('-stream_loop', '-1', '-i', audioPath);
    } else {
      ffmpegArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    }

    ffmpegArgs.push(
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '25',
      '-c:a', 'aac', '-b:a', '192k',
      '-t', totalDuration,
      '-movflags', '+faststart',
      '-f', 'mp4', outPath
    );

    await execFileAsync(bin, ffmpegArgs, { timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
    const outputBuffer = await fsp.readFile(outPath);
    return outputBuffer;
  } finally {
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { normalizeVideoBuffer, isMp4, resolveFfmpeg, createSliderVideo };
