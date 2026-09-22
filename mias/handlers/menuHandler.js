/**
 * MIAS — Menu Handler  v4
 *
 * Main bot menu system. Sends the full menu as ONE rich message:
 *   image header + body text + category buttons + externalAdReply
 *   → single sendMessage() via MenuBuilder → sendRichInteractive()
 *
 * No more separate vCard + text + buttons sends.
 * Falls back gracefully when interactive features are unavailable.
 *
 * Architecture:  Commands → Handlers → Baileys Adapter → WhatsApp
 */

import { sendImage, sendDocument }    from "./mediaHandler.js";
import { sendText }                   from "./messageHandler.js";
import { sendButtons, sendList, sendRichInteractive } from "./interactiveHandler.js";
import { sendBotVCard }               from "./contactHandler.js";
import { getBaileysVersion }          from "./baileysHandler.js";
import { isGktwAvailable }            from "./gktwAdapter.js";
import { formatUptime }               from "./utilityHandler.js";
import {
  MENU_CATEGORIES,
  getCategoryById,
  getTotalCommandCount,
}                                     from "./menuConfig.js";
import { getCapabilities }            from "./capabilityHandler.js";
import { MenuBuilder }                from "./builders/MenuBuilder.js";
import { fetchProfilePic }            from "./contactHandler.js";

// ─── Dynamic resolver (set by index.js via globalThis) ───────────────────────

function _getSock()   { return globalThis.__MIAS_SOCK__ || null; }

// ─── Bot info resolvers ────────────────────────────────────────────────────────

function _getOwner() {
  try {
    if (globalThis.__MIAS_CONFIG__?.OWNER) return globalThis.__MIAS_CONFIG__.OWNER;
    if (globalThis.__GET_SETTING__) { const s = globalThis.__GET_SETTING__("owner"); if (s) return s; }
  } catch {}
  return "MIAS Owner";
}
function _getPrefix() {
  try {
    if (globalThis.__MIAS_CONFIG__?.PREFIX) return globalThis.__MIAS_CONFIG__.PREFIX;
    if (globalThis.__GET_SETTING__) return globalThis.__GET_SETTING__("prefix") || ".";
  } catch {}
  return ".";
}
function _getVersion() {
  try { if (globalThis.__MIAS_CONFIG__?.VERSION) return globalThis.__MIAS_CONFIG__.VERSION; } catch {}
  return "5.3.1";
}
function _getBotName() {
  try {
    if (globalThis.__MIAS_CONFIG__?.BOT_NAME) return globalThis.__MIAS_CONFIG__.BOT_NAME;
    const sock = _getSock();
    if (sock?.user?.name) return sock.user.name;
  } catch {}
  return "MIAS BOT";
}
function _getMode() {
  try { if (globalThis.__GET_SETTING__) return globalThis.__GET_SETTING__("publicMode") ? "Public" : "Private"; } catch {}
  return "Unknown";
}
function _getCmdCount() {
  try {
    if (typeof globalThis.__MIAS_CMD_COUNT__ === "number") return globalThis.__MIAS_CMD_COUNT__;
    if (typeof globalThis.__MIAS_COMMANDS__ === "object") return globalThis.__MIAS_COMMANDS__.size;
  } catch {}
  return getTotalCommandCount();
}

// ─── Menu text builder ────────────────────────────────────────────────────────

function _buildMenuText(opts = {}) {
  const {
    botName, owner, prefix, version, uptime, ping,
    mode, cmdCount, userName,
  } = opts;

  const bar = "─".repeat(32);

  return [
    `*${botName}*`,
    bar,
    `Commands : ${cmdCount}`,
    `Uptime   : ${uptime || "0s"}`,
    ping != null ? `Ping     : ${ping}ms` : null,
    `Mode     : ${mode}`,
    `Version  : ${version}`,
    bar,
    `Select a category below.`,
  ].filter(l => l !== null).join("\n");
}

// ─── WhatsApp native buttons limit = 3 per message ───────────────────────────

function _chunk(arr, size = 3) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send the full bot menu as ONE rich interactive message.
 *
 * Combines: image header + bot info text + category buttons + externalAdReply card
 * → single sendMessage() via MenuBuilder → sendRichInteractive()
 *
 * Falls back gracefully: rich interactive → list → buttons → plain text.
 *
 * @param {object} sock
 * @param {string} jid
 * @param {object} [msg]            - WAMessage for quoted reply
 * @param {object} [opts]
 * @param {string} [opts.userName]  - Display name shown in the menu header
 * @param {number} [opts.ping]      - Latency in ms
 * @param {Buffer} [opts.coverImage] - Cover image buffer (falls back to bot profile pic)
 * @returns {Promise<void>}
 */
export async function sendMenu(sock, jid, msg, opts = {}) {
  const prefix   = _getPrefix();
  const botName  = _getBotName();
  const version  = _getVersion();
  const mode     = _getMode();
  const cmdCount = _getCmdCount();
  const uptime   = formatUptime(process.uptime?.() || 0);

  // Fetch bot profile picture for image header
  let coverImage = opts.coverImage || null;
  if (!coverImage) {
    try {
      const botJid = sock.user?.id;
      if (botJid) coverImage = await fetchProfilePic(sock, botJid);
    } catch {}
  }

  // ── Try MenuBuilder: ONE rich message with image + buttons + adReply ────────
  try {
    const mb = new MenuBuilder(sock, jid)
      .botName(botName)
      .cmdCount(cmdCount)
      .uptime(uptime)
      .prefix(prefix)
      .userName(opts.userName || "Guest")
      .version(version)
      .mode(mode)
      .categories(MENU_CATEGORIES)
      .footer(`${prefix}help <command> for details`)
      .quoted(msg);

    if (opts.ping != null) mb.ping(opts.ping);
    if (coverImage)        mb.coverImage(coverImage);

    return await mb.send();
  } catch {}

  // ── Fallback: interactive list (all categories) ───────────────────────────
  const caps = await getCapabilities(sock).catch(() => ({}));
  if (caps.lists) {
    try {
      const menuText = _buildMenuText({
        botName, owner: _getOwner(), prefix, version, uptime,
        ping: opts.ping ?? null, mode, cmdCount, userName: opts.userName,
      });
      const _realCats = (() => {
        try {
          const mc = globalThis.__MIAS_MENU_CATEGORIES__;
          if (Array.isArray(mc) && mc.length > 0) {
            return mc.filter(c=>c&&Array.isArray(c.cmds)&&c.cmds.length>0).map(cat => {
              const name  = (cat.name || cat.id || 'OTHER').toUpperCase();
              const emoji = cat.emoji || '📁';
              const cmds  = [...new Set(cat.cmds)];
              return { id: 'cat_'+name.toLowerCase(), label: emoji+' '+name, cmds };
            });
          }
        } catch {}
        return MENU_CATEGORIES;
      })();
      const rows = _realCats.map(cat => ({
        id:          cat.id,
        title:       (cat.label||cat.id).slice(0,24),
        description: `${[...new Set(cat.cmds||[])].length} commands`,
      }));
      return await sendList(sock, jid, menuText, [
        { title: "Categories", rows },
      ], {
        buttonText: "Open Categories",
        title:      botName,
        footer:     `${prefix}help <command> for details`,
        quoted:     msg,
      });
    } catch {}
  }

  // ── Fallback: buttons ────────────────────────────────────────────────────
  if (caps.buttons) {
    try {
      const menuText = _buildMenuText({
        botName, owner: _getOwner(), prefix, version, uptime,
        ping: opts.ping ?? null, mode, cmdCount, userName: opts.userName,
      });
      await sendText(sock, jid, menuText, { quoted: msg });
      const chunks = _chunk(MENU_CATEGORIES, 3);
      for (const chunk of chunks) {
        await sendButtons(sock, jid, "Choose a category:", chunk.map(c => ({
          text: c.label,
          id:   c.id,
        })), { quoted: msg });
      }
      return;
    } catch {}
  }

  // ── Last resort: plain text ──────────────────────────────────────────────
  const menuText = _buildMenuText({
    botName, owner: _getOwner(), prefix, version, uptime,
    ping: opts.ping ?? null, mode, cmdCount, userName: opts.userName,
  });
  const catList = MENU_CATEGORIES.map((c, i) =>
    `[${i + 1}] ${c.label} — ${c.cmds.length} cmds`
  ).join("\n");
  return sendText(sock, jid, `${menuText}\n\n${catList}`, { quoted: msg });
}

/**
 * Send the command list for a specific category.
 * Reads category from menuConfig — no hardcoded lists here.
 *
 * @param {object}   sock
 * @param {string}   jid
 * @param {string}   categoryId   - e.g. "cat_ai"
 * @param {object[]} [commands]   - Override list (optional, falls back to menuConfig)
 * @param {object}   [opts]
 * @param {object}   [opts.quoted]
 */
export async function sendCategoryMenu(sock, jid, categoryId, commands, opts = {}) {
  const cat    = getCategoryById(categoryId);
  const title  = cat ? cat.label : categoryId;
  const prefix = _getPrefix();

  // Use provided commands OR fall back to menuConfig
  const cmds = (commands?.length ? commands : (cat?.cmds || [])).slice(0, 10);

  const caps = await getCapabilities(sock);

  if (caps.lists) {
    try {
      const rows = cmds.map(c => ({
        id:          `cmd_${c.name}`,
        title:       `${prefix}${c.name}`,
        description: c.desc || "",
      }));
      return await sendList(sock, jid, `Commands in *${title}*:`, [
        { title, rows },
      ], {
        buttonText: "Browse",
        title,
        footer:     `${prefix}help <command> for details`,
        quoted:     opts.quoted,
      });
    } catch {}
  }

  const list = cmds.map(c => `  ${prefix}${c.name}  —  ${c.desc || "No description"}`).join("\n");
  return sendText(sock, jid,
    `*${title}*\n${"─".repeat(24)}\n${list}\n\nUse \`${prefix}help <command>\` for details.`,
    { quoted: opts.quoted }
  );
}

/**
 * Send a quick command-count summary.
 *
 * @param {object} sock
 * @param {string} jid
 * @param {object} [opts]
 * @param {object} [opts.quoted]
 */
export async function sendCommandCount(sock, jid, opts = {}) {
  const count  = _getCmdCount();
  const prefix = _getPrefix();
  const ver    = _getVersion();
  const text = [
    `*MIAS — Command Statistics*`,
    `${"─".repeat(28)}`,
    `Total commands : ${count}`,
    `Prefix         : ${prefix}`,
    `Version        : ${ver}`,
  ].join("\n");
  return sendText(sock, jid, text, { quoted: opts.quoted });
}
