/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           STICKER SETCMD SYSTEM — MAIS MDX                     ║
 * ║  Reply to a sticker with .setcmd <command> to bind it.         ║
 * ║  Sticker hash → command mapping persisted to JSON.             ║
 * ║  Survives restart, reconnect, deployment restart.              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * Usage:
 *   .setcmd menu      — reply to a sticker to bind it to .menu
 *   .delcmd           — reply to a sticker to remove its binding
 *   .listcmd          — list all sticker→command mappings
 */

import fs   from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, "..", "database", "sticker_commands.json");

// ── Persistence helpers ───────────────────────────────────────────────────────
function loadMappings() {
  try {
    if (!fs.existsSync(DB_PATH)) return {};
    const raw = fs.readFileSync(DB_PATH, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveMappings(map) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(map, null, 2), "utf8");
  } catch (e) {
    console.error("[StickerCmd] Failed to save mappings:", e.message);
  }
}

// In-memory cache loaded at startup
let _mappings = loadMappings();

// ── Hash computation from sticker message ─────────────────────────────────────
/**
 * Compute a stable hash for a sticker.
 * We use fileSha256 (from the sticker message) if available — it's the most
 * reliable sticker fingerprint. Fallback: hash the media key or fileEncSha256.
 */
export function getStickerHash(stickerMsg) {
  // stickerMsg is the raw proto stickerMessage object
  if (!stickerMsg) return null;
  try {
    const sha = stickerMsg.fileSha256 || stickerMsg.fileEncSha256;
    if (sha) {
      // sha is a Buffer or base64 string in different Baileys versions
      const buf = Buffer.isBuffer(sha) ? sha : Buffer.from(sha, "base64");
      return buf.toString("hex");
    }
    // Fallback: hash the mediaKey
    if (stickerMsg.mediaKey) {
      const buf = Buffer.isBuffer(stickerMsg.mediaKey)
        ? stickerMsg.mediaKey
        : Buffer.from(stickerMsg.mediaKey, "base64");
      return crypto.createHash("sha256").update(buf).digest("hex");
    }
    return null;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Bind a sticker hash to a command. Returns true on success. */
export function setCmd(hash, command) {
  if (!hash || !command) return false;
  const cmd = command.trim().replace(/^\./, ""); // normalize — strip leading dot
  if (!cmd) return false;
  _mappings[hash] = cmd;
  saveMappings(_mappings);
  return true;
}

/** Remove the command binding for a sticker hash. */
export function delCmd(hash) {
  if (!hash) return false;
  if (!_mappings[hash]) return false;
  delete _mappings[hash];
  saveMappings(_mappings);
  return true;
}

/** Look up the command bound to a sticker hash. Returns null if none. */
export function getCmd(hash) {
  if (!hash) return null;
  _mappings = loadMappings(); // re-read to stay fresh (case.js writes via CJS bridge)
  return _mappings[hash] || null;
}

/** Return all mappings as { hash: command } plain object. */
export function listCmds() {
  return { ..._mappings };
}

/** Total number of registered sticker commands. */
export function cmdCount() {
  return Object.keys(_mappings).length;
}

/** Reload from disk (e.g. after external edit). */
export function reloadMappings() {
  _mappings = loadMappings();
}
