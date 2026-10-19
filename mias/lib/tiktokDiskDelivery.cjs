"use strict";

const fs = require("fs");

function hasMp4Signature(prefix) {
  return Buffer.isBuffer(prefix)
    && prefix.length >= 12
    && prefix.subarray(4, 8).toString("ascii") === "ftyp";
}

function createTikTokFileName(title, extension = ".mp4") {
  const requestedExtension = String(extension || ".mp4").toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,8}$/.test(requestedExtension)
    ? requestedExtension
    : ".mp4";
  const safeTitle = Array.from(String(title || "").normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/g, "")
    .replace(/[. ]+$/g, ""))
    .slice(0, 120)
    .join("")
    .replace(/[. ]+$/g, "");
  const baseName = safeTitle || "TikTok video";
  return baseName.toLowerCase().endsWith(safeExtension)
    ? baseName
    : `${baseName}${safeExtension}`;
}

async function fetchVideoCandidate(url, {
  pipeline,
  cap,
  maxBufferedBytes,
  timeout = 90000,
  headers,
} = {}) {
  if (!pipeline || typeof pipeline.fetchToDisk !== "function") {
    throw new TypeError("A media pipeline with fetchToDisk is required");
  }

  const downloaded = await pipeline.fetchToDisk(url, { cap, timeout, headers });
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (typeof downloaded.cleanup === "function") {
      await downloaded.cleanup();
    } else if (downloaded.path) {
      await fs.promises.rm(downloaded.path, { force: true });
    }
  };

  try {
    const bytes = Number(downloaded.bytes) || fs.statSync(downloaded.path).size;
    if (bytes < 2048) {
      await cleanup();
      return null;
    }

    const fd = fs.openSync(downloaded.path, "r");
    let prefix;
    try {
      prefix = Buffer.alloc(Math.min(64, bytes));
      const read = fs.readSync(fd, prefix, 0, prefix.length, 0);
      prefix = prefix.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }

    const head = prefix.toString("utf8").trim().toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("{")) {
      await cleanup();
      return null;
    }

    // The normalizer's documented 120 MiB input limit makes it a no-op above
    // this size. Keep large non-MP4 responses off the heap too: reject them
    // rather than reading an unexpected large payload into a Buffer.
    if (bytes > maxBufferedBytes) {
      if (!hasMp4Signature(prefix)) {
        await cleanup();
        return null;
      }
      return {
        buffer: null,
        file: { path: downloaded.path, bytes, cleanup },
      };
    }

    const buffer = fs.readFileSync(downloaded.path);
    await cleanup();
    return { buffer, file: null, bytes };
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}

function sendVideoFromDisk(sock, jid, filePath, caption, msg) {
  return sock.sendMessage(
    jid,
    { video: { url: filePath }, mimetype: "video/mp4", caption },
    { quoted: msg },
  );
}

function sendDocumentFromDisk(sock, jid, filePath, fileName, caption, msg) {
  return sock.sendMessage(
    jid,
    { document: { url: filePath }, mimetype: "video/mp4", fileName, caption },
    { quoted: msg },
  );
}

module.exports = {
  createTikTokFileName,
  fetchVideoCandidate,
  hasMp4Signature,
  sendDocumentFromDisk,
  sendVideoFromDisk,
};
