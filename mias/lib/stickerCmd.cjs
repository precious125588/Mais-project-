/**
 * CJS bridge for stickerCmd.js — allows require() from case.js (CJS)
 */
"use strict";
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "database", "sticker_commands.json");

function loadMappings() {
  try {
    if (!fs.existsSync(DB_PATH)) return {};
    const raw = fs.readFileSync(DB_PATH, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function saveMappings(map) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(map, null, 2), "utf8");
  } catch (e) { console.error("[StickerCmd] Save failed:", e.message); }
}

let _mappings = loadMappings();

function getStickerHash(stickerMsg) {
  if (!stickerMsg) return null;
  try {
    const sha = stickerMsg.fileSha256 || stickerMsg.fileEncSha256;
    if (sha) {
      const buf = Buffer.isBuffer(sha) ? sha : Buffer.from(sha, "base64");
      return buf.toString("hex");
    }
    if (stickerMsg.mediaKey) {
      const buf = Buffer.isBuffer(stickerMsg.mediaKey) ? stickerMsg.mediaKey : Buffer.from(stickerMsg.mediaKey, "base64");
      return crypto.createHash("sha256").update(buf).digest("hex");
    }
    return null;
  } catch { return null; }
}

function stickerSetCmd(hash, command) {
  if (!hash || !command) return false;
  const cmd = command.trim().replace(/^\./, "");
  if (!cmd) return false;
  _mappings = loadMappings(); // re-read from disk
  _mappings[hash] = cmd;
  saveMappings(_mappings);
  return true;
}

function stickerDelCmd(hash) {
  if (!hash) return false;
  _mappings = loadMappings();
  if (!_mappings[hash]) return false;
  delete _mappings[hash];
  saveMappings(_mappings);
  return true;
}

function stickerGetCmd(hash) {
  if (!hash) return null;
  _mappings = loadMappings(); // re-read to stay fresh
  return _mappings[hash] || null;
}

function stickerListCmds() { _mappings = loadMappings(); return { ..._mappings }; }
function stickerCmdCount() { _mappings = loadMappings(); return Object.keys(_mappings).length; }

module.exports = { getStickerHash, stickerSetCmd, stickerDelCmd, stickerGetCmd, stickerListCmds, stickerCmdCount };
