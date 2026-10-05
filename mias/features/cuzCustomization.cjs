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

function unwrapAny(m) {
  let cur = m;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const nxt = cur.ephemeralMessage?.message
      || cur.viewOnceMessage?.message
      || cur.viewOnceMessageV2?.message
      || cur.viewOnceMessageV2Extension?.message
      || cur.documentWithCaptionMessage?.message
      || cur.editedMessage?.message
      || null;
    if (!nxt) break;
    cur = nxt;
  }
  return cur;
}

function collectAllText(m) {
  const texts = [];
  if (!m || typeof m !== "object") return texts;
  texts.push(
    m.conversation,
    m.extendedTextMessage?.text,
    m.imageMessage?.caption,
    m.videoMessage?.caption,
    m.documentMessage?.caption,
    m.interactiveMessage?.body?.text,
    m.interactiveMessage?.footer?.text,
    m.interactiveMessage?.header?.title,
    m.buttonsMessage?.contentText,
    m.buttonsMessage?.footer,
    m.listMessage?.description,
    m.listMessage?.title
  );
  for (const k of Object.keys(m)) {
    const v = m[k];
    if (v && typeof v === "object" && v.message) {
      texts.push(...collectAllText(v.message));
    }
  }
  return texts.filter(Boolean);
}

async function handleCuzReply(sock, msg, body, P) {
  try {
    const { getSettings, saveNow, CONFIG } = P;
    const jid = msg.key.remoteJid;
    const isGroup = String(jid || "").endsWith("@g.us");
    const sender = isGroup ? (msg.key.participant || msg.participant) : jid;
    const userId = String(sender || "").replace(/:[0-9]+@/, "@");
    const sessionKey = `${jid}:${userId}`;

    const rawCtx = msg.message?.extendedTextMessage?.contextInfo
      || msg.message?.imageMessage?.contextInfo
      || msg.message?.videoMessage?.contextInfo
      || msg.message?.documentMessage?.contextInfo
      || msg.message?.interactiveResponseMessage?.contextInfo;

    const rawQ = unwrapAny(rawCtx?.quotedMessage);
    const qTexts = rawQ ? collectAllText(rawQ) : [];
    const quotedText = qTexts.join(" ");

    const isCuzQuoted = /CUSTOMIZ|BRANDING|PRESENTATION|Prefix|Bot Name|Bot Owner|Pack Name|Author Name|Footer|Welcome Text|Goodbye Text|Menu Header|Menu Footer|Menu Emoji|Time Format|Date Format|Reset|\bcuz\b/i.test(quotedText);

    let sess = pendingSessions.get(sessionKey);
    if (!sess && isCuzQuoted) {
      sess = {
        chatId: jid,
        userId: userId,
        menuMessageId: rawCtx?.stanzaId,
        pendingValue: null,
        awaitingValueOption: null,
        createdAt: Date.now()
      };
      pendingSessions.set(sessionKey, sess);
    }

    if (!sess && !isCuzQuoted) {
      return false;
    }

    // Refresh TTL on interaction
    if (sess) sess.createdAt = Date.now();

    const rawInput = String(body || "").trim();

    // 1. If currently awaiting a text value for a previously selected option
    if (sess && sess.awaitingValueOption) {
      const opt = sess.awaitingValueOption;
      const validation = validateCustomizationValue(opt, rawInput);
      if (!validation.valid) {
        await sock.sendMessage(jid, { text: `❌ Invalid input for *${opt.label}*:\n${validation.error}\n\nPlease try again:` }, { quoted: msg });
        return true;
      }
      setCustomization(jid, isGroup, opt.id, validation.value, getSettings, saveNow);
      if (opt.id === "prefix" && CONFIG) CONFIG.PREFIX = validation.value;
      if (opt.id === "botName" && CONFIG) CONFIG.BOT_NAME = validation.value;
      pendingSessions.delete(sessionKey);
      await sock.sendMessage(jid, { text: `✅ *${opt.label}* changed to: *${validation.value}*` }, { quoted: msg });
      return true;
    }

    // 2. Expecting option selection number (1 to 17)
    const norm = rawInput.replace(/^[`*_~.#/!]+|[`*_~]+$/g, "").trim();
    const numMatch = norm.match(/^(\d{1,2})$/);

    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      if (num < 1 || num > customizationOptions.length) {
        await sock.sendMessage(jid, { text: `❌ Invalid option *${num}*. Please reply with a number from *1 to ${customizationOptions.length}*.` }, { quoted: msg });
        return true;
      }

      const opt = customizationOptions[num - 1];

      if (opt.id === "reset") {
        resetCustomization(jid, isGroup, getSettings, saveNow);
        pendingSessions.delete(sessionKey);
        await sock.sendMessage(jid, { text: "✅ All customization settings have been reset to default values." }, { quoted: msg });
        return true;
      }

      if (sess && sess.pendingValue) {
        const validation = validateCustomizationValue(opt, sess.pendingValue);
        if (!validation.valid) {
          pendingSessions.delete(sessionKey);
          await sock.sendMessage(jid, { text: `❌ Invalid input for *${opt.label}*:\n${validation.error}` }, { quoted: msg });
          return true;
        }
        setCustomization(jid, isGroup, opt.id, validation.value, getSettings, saveNow);
        if (opt.id === "prefix" && CONFIG) CONFIG.PREFIX = validation.value;
        if (opt.id === "botName" && CONFIG) CONFIG.BOT_NAME = validation.value;
        pendingSessions.delete(sessionKey);
        await sock.sendMessage(jid, { text: `✅ *${opt.label}* changed to: *${validation.value}*` }, { quoted: msg });
        return true;
      }

      // Enter waiting state for the option's value
      if (!sess) {
        sess = { chatId: jid, userId, menuMessageId: rawCtx?.stanzaId, pendingValue: null, awaitingValueOption: opt, createdAt: Date.now() };
        pendingSessions.set(sessionKey, sess);
      } else {
        sess.awaitingValueOption = opt;
      }

      let promptGuide = "";
      if (opt.type === "emoji") promptGuide = " (send 1 or 2 emojis)";
      else if (opt.type === "timeFormat") promptGuide = " (type *12h* or *24h*)";
      else if (opt.type === "dateFormat") promptGuide = " (e.g. *DD/MM/YYYY* or *MM/DD/YYYY*)";
      else promptGuide = " (type the new text)";

      await sock.sendMessage(jid, { text: `✏️ Send the new value for *${opt.label}*${promptGuide}:` }, { quoted: msg });
      return true;
    }

    // If the user quoted the cuz card with something else, give helpful guidance instead of going silent
    if (isCuzQuoted) {
      await sock.sendMessage(jid, { text: `ℹ️ *Customization Menu*\n\nPlease reply with a number from *1 to ${customizationOptions.length}* to select an option to customize.` }, { quoted: msg });
      return true;
    }

    return false;
  } catch (err) {
    console.error("[cuzCustomization] handleCuzReply error:", err?.message || err);
    return false;
  }
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
