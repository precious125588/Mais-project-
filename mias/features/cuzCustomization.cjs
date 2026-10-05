// mias/features/cuzCustomization.js
// Complete persistent .cuz customization system for MIA'S MDX

"use strict";


const customizationOptions = [
  { id: "prefix", label: "Prefix", type: "text", default: "." },
  { id: "botName", label: "Bot Name", type: "text", default: "MIA'S MDX" },
  { id: "botOwner", label: "Bot Owner", type: "text", default: "𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x" },
  { id: "footer", label: "Footer", type: "text", default: "Powered by 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x" },
  { id: "emoji", label: "Emoji", type: "emoji", default: "🌀" },
  { id: "statusEmoji", label: "Status Emoji", type: "emoji", default: "🟢" },
  { id: "welcomeText", label: "Welcome Text", type: "text", default: "Welcome @user to @group!" },
  { id: "goodbyeText", label: "Goodbye Text", type: "text", default: "Goodbye @user from @group!" },
  { id: "menuHeader", label: "Menu Header", type: "text", default: "╭━━〔 MIA'S MDX 〕━━╮" },
  { id: "menuFooter", label: "Menu Footer", type: "text", default: "╰━━━━━━━━━━━━━━━━━━╯" },
  { id: "menuEmoji", label: "Menu Emoji", type: "emoji", default: "❖" },
  { id: "botProfile", label: "Bot Profile", type: "text", default: "https://files.catbox.moe/05rqy6.png" },
  { id: "packName", label: "Pack Name", type: "text", default: "MIA'S MDX" },
  { id: "authorName", label: "Author Name", type: "text", default: "𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x" },
  { id: "timeFormat", label: "Time Format", type: "timeFormat", default: "12h" },
  { id: "dateFormat", label: "Date Format", type: "dateFormat", default: "DD/MM/YYYY" },
  { id: "reset", label: "Reset", type: "reset", default: null }
];

const pendingSessions = new Map(); // key: chatId:userId -> session
const SESSION_TTL = 5 * 60 * 1000; // 5 minutes

function cleanOldSessions() {
  const now = Date.now();
  for (const [k, v] of pendingSessions.entries()) {
    if (now - v.createdAt > SESSION_TTL) {
      pendingSessions.delete(k);
    }
  }
}
setInterval(cleanOldSessions, 60000).unref();

function getScopeKey(jid, isGroup) {
  return isGroup ? jid : "global_cuz";
}

function getCustomization(jid, isGroup, getSettingsFn) {
  try {
    const key = getScopeKey(jid, isGroup);
    const setObj = getSettingsFn ? getSettingsFn(key) : null;
    const cuz = (setObj && setObj.__cuz) ? setObj.__cuz : {};
    const res = {};
    for (const opt of customizationOptions) {
      if (opt.id === "reset") continue;
      res[opt.id] = (cuz[opt.id] !== undefined && cuz[opt.id] !== null) ? cuz[opt.id] : opt.default;
    }
    return res;
  } catch (e) {
    const res = {};
    for (const opt of customizationOptions) {
      if (opt.id !== "reset") res[opt.id] = opt.default;
    }
    return res;
  }
}

function setCustomization(jid, isGroup, key, val, getSettingsFn, saveNowFn) {
  try {
    const scope = getScopeKey(jid, isGroup);
    const setObj = getSettingsFn ? getSettingsFn(scope) : null;
    if (setObj) {
      if (!setObj.__cuz) setObj.__cuz = {};
      setObj.__cuz[key] = val;
      if (typeof saveNowFn === "function") saveNowFn();
      return true;
    }
  } catch (e) {
    console.error("[CUZ setCustomization]", e);
  }
  return false;
}

function resetCustomization(jid, isGroup, getSettingsFn, saveNowFn) {
  try {
    const scope = getScopeKey(jid, isGroup);
    const setObj = getSettingsFn ? getSettingsFn(scope) : null;
    if (setObj) {
      setObj.__cuz = {};
      if (typeof saveNowFn === "function") saveNowFn();
      return true;
    }
  } catch (e) {
    console.error("[CUZ resetCustomization]", e);
  }
  return false;
}

function validateCustomizationValue(opt, val) {
  const s = String(val || "").trim();
  if (opt.type === "reset") return { valid: true };

  if (opt.type === "emoji") {
    if (!s) return { valid: false, error: "Emoji cannot be empty." };
    if (s.length > 8) return { valid: false, error: "Please provide a valid single emoji symbol." };
    return { valid: true, value: s };
  }

  if (opt.type === "timeFormat") {
    const lower = s.toLowerCase();
    if (lower === "12h" || lower === "24h") return { valid: true, value: lower };
    return { valid: false, error: "Accepted time formats: 12h or 24h" };
  }

  if (opt.type === "dateFormat") {
    const upper = s.toUpperCase();
    if (["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY"].includes(upper)) {
      return { valid: true, value: upper };
    }
    return { valid: false, error: "Accepted date formats: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD" };
  }

  if (opt.type === "text") {
    if (!s) return { valid: false, error: "Text value cannot be empty." };
    if (opt.id === "prefix") {
      if (s.length > 5) return { valid: false, error: "Prefix should be 1-3 characters (e.g. ., !, #)." };
    }
    return { valid: true, value: s };
  }

  return { valid: true, value: s };
}

function resolveCustomizationPlaceholders(text, ctx = {}) {
  if (!text) return "";
  let out = String(text);
  const rep = {
    "@user": ctx.user ? `@${String(ctx.user).split("@")[0].split(":")[0]}` : "@user",
    "@username": ctx.username || ctx.pushName || "@username",
    "@group": ctx.groupName || "@group",
    "@botname": ctx.botName || "MIA'S MDX",
    "@owner": ctx.ownerName || "𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x",
    "@prefix": ctx.prefix || ".",
    "@date": ctx.date || new Date().toLocaleDateString(),
    "@time": ctx.time || new Date().toLocaleTimeString()
  };
  for (const [k, v] of Object.entries(rep)) {
    out = out.split(k).join(v);
  }
  return out;
}

function buildCustomizeMenuText() {
  let lines = [
    "╭━━〔 CUSTOMIZE 〕━━╮",
    "┃",
    "┃ 1. Prefix",
    "┃ 2. Bot Name",
    "┃ 3. Bot Owner",
    "┃ 4. Footer",
    "┃ 5. Emoji",
    "┃ 6. Status Emoji",
    "┃ 7. Welcome Text",
    "┃ 8. Goodbye Text",
    "┃ 9. Menu Header",
    "┃ 10. Menu Footer",
    "┃ 11. Menu Emoji",
    "┃ 12. Bot Profile",
    "┃ 13. Pack Name",
    "┃ 14. Author Name",
    "┃ 15. Time Format",
    "┃ 16. Date Format",
    "┃ 17. Reset",
    "┃",
    "╰━━━━━━━━━━━━━━━━━━╯"
  ];
  return lines.join("\n");
}


async function getBotPicForCuz(sock, jid, getSettingsFn) {
  // 1. Check custom botProfile from cuz settings
  try {
    if (typeof getSettingsFn === "function") {
      const set = getSettingsFn(jid) || getSettingsFn("global_cuz");
      const customPic = set?.__cuz?.botProfile;
      if (customPic && typeof customPic === "string" && customPic.startsWith("http")) {
        let resp = null;
        try {
          const a = require("axios");
          resp = await a.get(customPic, { responseType: "arraybuffer", timeout: 10000 });
        } catch (_) {
          if (typeof fetch === "function") {
            const fRes = await fetch(customPic).catch(() => null);
            if (fRes?.ok) {
              const arr = await fRes.arrayBuffer();
              resp = { data: Buffer.from(arr) };
            }
          }
        }
        if (resp?.data && Buffer.isBuffer(resp.data) && resp.data.length > 500) {
          return resp.data;
        }
        return { url: customPic };
      }
    }
  } catch (_) {}

  // 2. Try live bot WhatsApp profile picture
  try {
    const me = sock?.user?.id;
    if (me && typeof sock.profilePictureUrl === "function") {
      const pUrl = await sock.profilePictureUrl(me, "image").catch(() => null)
                || await sock.profilePictureUrl(me, "preview").catch(() => null);
      if (pUrl) {
        let resp = null;
        try {
          const a = require("axios");
          resp = await a.get(pUrl, { responseType: "arraybuffer", timeout: 10000 });
        } catch (_) {
          if (typeof fetch === "function") {
            const fRes = await fetch(pUrl).catch(() => null);
            if (fRes?.ok) {
              const arr = await fRes.arrayBuffer();
              resp = { data: Buffer.from(arr) };
            }
          }
        }
        if (resp?.data && Buffer.isBuffer(resp.data) && resp.data.length > 500) {
          return resp.data;
        }
        return { url: pUrl };
      }
    }
  } catch (_) {}

  // 3. Fallback to global getBotPic if present
  try {
    if (typeof globalThis.getBotPic === "function") {
      const b = await globalThis.getBotPic();
      if (b) return b;
    }
  } catch (_) {}

  // 4. Default catbox avatar
  try {
    const defaultUrl = "https://files.catbox.moe/05rqy6.png";
    let resp = null;
    try {
      const a = require("axios");
      resp = await a.get(defaultUrl, { responseType: "arraybuffer", timeout: 10000 });
    } catch (_) {
      if (typeof fetch === "function") {
        const fRes = await fetch(defaultUrl).catch(() => null);
        if (fRes?.ok) {
          const arr = await fRes.arrayBuffer();
          resp = { data: Buffer.from(arr) };
        }
      }
    }
    if (resp?.data && Buffer.isBuffer(resp.data)) return resp.data;
    return { url: defaultUrl };
  } catch (_) {
    return { url: "https://files.catbox.moe/05rqy6.png" };
  }
}

function installCuzSystem(P) {
  const { commands, cmd, CONFIG, sendReply, getSettings, saveNow } = P;

  const handler = async (sock, msg, args) => {
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith("@g.us");
    const sender = isGroup ? (msg.key.participant || msg.participant) : jid;
    const userId = String(sender).replace(/:[0-9]+@/, "@");
    const rawVal = args.join(" ").trim();

    const menuText = buildCustomizeMenuText();
    let sentMsg = null;
    let botPic = null;
    try {
      botPic = await getBotPicForCuz(sock, jid, getSettings);
    } catch (_) {}

    if (botPic) {
      try {
        sentMsg = await sock.sendMessage(jid, {
          image: botPic,
          caption: menuText
        }, { quoted: msg });
      } catch (eImg) {
        console.error("[CUZ IMAGE SEND ERROR]", eImg?.message || eImg);
      }
    }

    if (!sentMsg) {
      sentMsg = await sock.sendMessage(jid, { text: menuText }, { quoted: msg });
    }
    const menuMsgId = sentMsg?.key?.id;

    if (menuMsgId) {
      const sessionKey = `${jid}:${userId}`;
      pendingSessions.set(sessionKey, {
        chatId: jid,
        userId: userId,
        menuMessageId: menuMsgId,
        pendingValue: rawVal || null,
        awaitingValueOption: null,
        createdAt: Date.now()
      });
    }
  };

  if (typeof cmd === "function") {
    cmd(["cuz", "customize"], {
      desc: "Customize bot presentation, branding, and text",
      category: "CUSTOMIZATION"
    }, handler);
  }
}

async function handleCuzReply(sock, msg, body, P) {
  const { getSettings, saveNow, CONFIG } = P;
  const jid = msg.key.remoteJid;
  const isGroup = jid.endsWith("@g.us");
  const sender = isGroup ? (msg.key.participant || msg.participant) : jid;
  const userId = String(sender).replace(/:[0-9]+@/, "@");
  const sessionKey = `${jid}:${userId}`;

  let sess = pendingSessions.get(sessionKey);
  const _rawCtx = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo;
  const _qMsg = _rawCtx?.quotedMessage;
  const _qText = String(_qMsg?.conversation || _qMsg?.extendedTextMessage?.text || _qMsg?.imageMessage?.caption || _qMsg?.videoMessage?.caption || "");
  const _isCuzText = /CUSTOMIZE|CUSTOMIZATION|BRANDING|PRESENTATION|Prefix|Bot Name|Bot Owner/i.test(_qText);

  if (!sess && _isCuzText) {
    sess = {
      chatId: jid,
      userId: userId,
      menuMessageId: _rawCtx?.stanzaId,
      pendingValue: null,
      awaitingValueOption: null,
      createdAt: Date.now()
    };
    pendingSessions.set(sessionKey, sess);
  }
  if (!sess) return false;

  const ctx = msg.message?.extendedTextMessage?.contextInfo
            || msg.message?.imageMessage?.contextInfo
            || msg.message?.videoMessage?.contextInfo
            || msg.message?.documentMessage?.contextInfo;
  const quotedId = ctx?.stanzaId;
  const rawText = String(body || "").trim();

  // If waiting for a value after empty .cuz
  if (sess.awaitingValueOption) {
    const opt = sess.awaitingValueOption;
    const validation = validateCustomizationValue(opt, rawText);
    if (!validation.valid) {
      await sock.sendMessage(jid, { text: `Invalid input.\n${validation.error}` }, { quoted: msg });
      return true;
    }
    setCustomization(jid, isGroup, opt.id, validation.value, getSettings, saveNow);
    if (opt.id === "prefix") CONFIG.PREFIX = validation.value;
    if (opt.id === "botName") CONFIG.BOT_NAME = validation.value;
    pendingSessions.delete(sessionKey);
    await sock.sendMessage(jid, { text: `${opt.label} changed to ${validation.value}` }, { quoted: msg });
    return true;
  }

  // Expecting menu option number reply
  const isCuzQuoted = (quotedId && (quotedId === sess.menuMessageId || quotedId === sess.menuMessageId?.id))
    || (ctx && /\/CUZ|CUSTOMIZ|BRANDING|PRESENTATION/i.test(String(ctx.quotedMessage?.conversation || ctx.quotedMessage?.extendedTextMessage?.text || ctx.quotedMessage?.imageMessage?.caption || "")))
    || (Date.now() - sess.createdAt < 10 * 60 * 1000);

  if (isCuzQuoted) {
    const num = parseInt(rawText, 10);
    if (isNaN(num) || num < 1 || num > customizationOptions.length) {
      await sock.sendMessage(jid, { text: "Invalid option. Please reply with a number from 1 to 17." }, { quoted: msg });
      return true;
    }

    const opt = customizationOptions[num - 1];

    if (opt.id === "reset") {
      resetCustomization(jid, isGroup, getSettings, saveNow);
      pendingSessions.delete(sessionKey);
      await sock.sendMessage(jid, { text: "All customization settings have been reset to default values." }, { quoted: msg });
      return true;
    }

    if (sess.pendingValue) {
      const validation = validateCustomizationValue(opt, sess.pendingValue);
      if (!validation.valid) {
        pendingSessions.delete(sessionKey);
        await sock.sendMessage(jid, { text: `Invalid input.\n${validation.error}` }, { quoted: msg });
        return true;
      }
      setCustomization(jid, isGroup, opt.id, validation.value, getSettings, saveNow);
      if (opt.id === "prefix") CONFIG.PREFIX = validation.value;
      if (opt.id === "botName") CONFIG.BOT_NAME = validation.value;
      pendingSessions.delete(sessionKey);

      if (opt.id.toLowerCase().includes("text") || opt.id.toLowerCase().includes("header") || (opt.id.toLowerCase().includes("footer") && opt.id !== "footer")) {
        await sock.sendMessage(jid, { text: `${opt.label} changed successfully.` }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { text: `${opt.label} changed to ${validation.value}` }, { quoted: msg });
      }
      return true;
    } else {
      // Empty .cuz: ask for value
      sess.awaitingValueOption = opt;
      sess.createdAt = Date.now();
      await sock.sendMessage(jid, { text: `Send the new value for ${opt.label}.` }, { quoted: msg });
      return true;
    }
  }

  return false;
}

module.exports = {
  customizationOptions,
  getCustomization,
  setCustomization,
  resetCustomization,
  validateCustomizationValue,
  resolveCustomizationPlaceholders,
  buildCustomizeMenuText,
  installCuzSystem,
  handleCuzReply
};
