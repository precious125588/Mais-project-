// .split and .remux — reply to (or send with the caption) a video or a video
// document. .split cuts it into 90 second MP4 parts and sends each part in
// order. .remux repackages it as MP4 without re-encoding when the codecs allow.
import fs from "fs";
import os from "os";
import path from "path";
import {
  probeFile, splitVideoFile, remuxToMp4, splitPlan, fmtDuration, SPLIT_SECONDS,
  WA_VIDEO_MAX_BYTES, WA_DOC_MAX_BYTES, VIDEO_DOC_EXTS,
} from "../lib/videoTools.js";

const DOWNLOAD_TIMEOUT_MS = 120000;
const unwrap = (m) => {
  let cur = m;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const next = cur.ephemeralMessage?.message
      || cur.viewOnceMessage?.message
      || cur.viewOnceMessageV2?.message
      || cur.viewOnceMessageV2Extension?.message
      || cur.documentWithCaptionMessage?.message
      || cur.editedMessage?.message
      || null;
    if (!next) break;
    cur = next;
  }
  return cur;
};

function isVideoDocument(doc) {
  const mime = String(doc?.mimetype || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  const name = String(doc?.fileName || "").toLowerCase();
  const ext = (name.match(/\.([a-z0-9]+)$/) || [])[1] || "";
  return VIDEO_DOC_EXTS.includes(ext);
}

// Finds a video, video note or video document in one message node.
export function findVideoIn(message) {
  const u = unwrap(message);
  if (!u) return null;
  if (u.videoMessage) return { node: u.videoMessage, dlType: "video", ext: "mp4" };
  if (u.ptvMessage) return { node: u.ptvMessage, dlType: "video", ext: "mp4" };
  if (u.documentMessage && isVideoDocument(u.documentMessage)) {
    const name = String(u.documentMessage.fileName || "");
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "mp4";
    return { node: u.documentMessage, dlType: "document", ext };
  }
  return null;
}

// Quoted video first, then the message itself (a video sent with ".split" as its caption).
export function pickVideoSource(msg) {
  const ctxInfo = msg?.message?.extendedTextMessage?.contextInfo
    || msg?.message?.videoMessage?.contextInfo
    || msg?.message?.documentMessage?.contextInfo
    || null;
  const quoted = ctxInfo?.quotedMessage;
  return (quoted && findVideoIn(quoted)) || findVideoIn(msg?.message);
}

function withTimeout(promise, ms, label) {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label} timed out`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

export function installSplitVideo(ctx) {
  const { cmd, sendReply, react, downloadContentFromMessage, CONFIG } = ctx;
  const PREFIX = CONFIG?.PREFIX || ".";

  async function downloadVideo(src) {
    const work = (async () => {
      const stream = await downloadContentFromMessage(src.node, src.dlType);
      const chunks = [];
      let total = 0;
      for await (const c of stream) {
        total += c.length;
        if (total > WA_DOC_MAX_BYTES) { try { stream.destroy?.(); } catch {} throw new Error("the video is over WhatsApp's 2 GB limit"); }
        chunks.push(c);
      }
      return Buffer.concat(chunks);
    })();
    return withTimeout(work, DOWNLOAD_TIMEOUT_MS, "Download");
  }

  async function sendVideoFile(sock, jid, msg, file, caption) {
    const buf = fs.readFileSync(file);
    if (buf.length > WA_DOC_MAX_BYTES) throw new Error("a part is over WhatsApp's 2 GB limit");
    if (buf.length > WA_VIDEO_MAX_BYTES) {
      await sock.sendMessage(jid, { document: buf, mimetype: "video/mp4", fileName: path.basename(file), caption }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, { video: buf, mimetype: "video/mp4", caption }, { quoted: msg });
    }
  }

  cmd(["split"], {
    desc: `Split a video into ${SPLIT_SECONDS} second parts — reply to a video or video document`,
    category: "MEDIA",
  }, async (sock, msg) => {
    const jid = msg.key.remoteJid;
    const src = pickVideoSource(msg);
    if (!src) {
      await react(sock, msg, "❌");
      await sendReply(sock, msg, `Reply to a *video* or *video file* with ${PREFIX}split. Each part will be ${SPLIT_SECONDS} seconds.`);
      return;
    }
    await react(sock, msg, "🌀");
    let dir = null;
    try {
      const buf = await downloadVideo(src);
      if (!buf.length) throw new Error("the video could not be downloaded from WhatsApp");
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "split-"));
      const inPath = path.join(dir, `in.${src.ext}`);
      fs.writeFileSync(inPath, buf);

      const info = await probeFile(inPath);
      if (!info.duration) throw new Error("I couldn't read that video's length");
      const plan = splitPlan(info.duration);
      if (!plan.needed) {
        await react(sock, msg, "❌");
        await sendReply(sock, msg, `⏱️ That video is ${fmtDuration(info.duration)} long. The split limit is ${SPLIT_SECONDS} seconds, so it doesn't need splitting.`);
        return;
      }

      const partsDir = path.join(dir, "parts");
      fs.mkdirSync(partsDir);
      const parts = await splitVideoFile(inPath, partsDir, info, SPLIT_SECONDS);
      if (!parts.length) throw new Error("the split produced no parts");
      for (let i = 0; i < parts.length; i++) {
        await sendVideoFile(sock, jid, msg, parts[i], `Part ${i + 1}/${parts.length} · ${SPLIT_SECONDS}s max`);
      }
      await react(sock, msg, "✅");
    } catch (e) {
      console.error("[split] error:", e?.message || e);
      await react(sock, msg, "❌");
      await sendReply(sock, msg, `❌ Split failed: ${e?.message || e}`);
    } finally {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
    }
  });

  cmd(["remux"], {
    desc: "Repackage a video as MP4 without re-encoding when possible — reply to a video or video file",
    category: "MEDIA",
  }, async (sock, msg) => {
    const jid = msg.key.remoteJid;
    const src = pickVideoSource(msg);
    if (!src) {
      await react(sock, msg, "❌");
      await sendReply(sock, msg, `Reply to a *video* or *video file* with ${PREFIX}remux.`);
      return;
    }
    await react(sock, msg, "🌀");
    let dir = null;
    try {
      const buf = await downloadVideo(src);
      if (!buf.length) throw new Error("the video could not be downloaded from WhatsApp");
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "remux-"));
      const inPath = path.join(dir, `in.${src.ext}`);
      const outPath = path.join(dir, "out.mp4");
      fs.writeFileSync(inPath, buf);
      const info = await probeFile(inPath);
      await remuxToMp4(inPath, outPath, info);
      await sendVideoFile(sock, jid, msg, outPath, "Remuxed to MP4 (no re-encode)");
      await react(sock, msg, "✅");
    } catch (e) {
      console.error("[remux] error:", e?.message || e);
      await react(sock, msg, "❌");
      await sendReply(sock, msg, `❌ Remux failed: ${e?.message || e}`);
    } finally {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
    }
  });
}
