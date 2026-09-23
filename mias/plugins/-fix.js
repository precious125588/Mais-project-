/**
 * PRECIOUS FIX PACK — mias/plugins/precious-fix.js
 * Auto-discovered by PluginSystem. Re-registers:
 *   .play (new card + choice player), .video, .getpp, .add, and NSFW downloaders.
 *
 * Root causes fixed:
 *  - NSFW: old providers (princetechn, bk9, widipe, davidcyriltech.my.id, diioffc,
 *    aemt.me, keyless api.davidcyril.name.ng) are ALL dead / rate-limited -> silent fail.
 *  - .play was registered as "play_legacy_disabled" (never fired).
 *  - .video chain was all dead -> "all providers busy".
 *  - .getpp in DM with no target returned SELF instead of the chat partner.
 *  - .add had no VCF support and no outside-of-group <gclink> support.
 *
 * Live providers used (tested):
 *   search : api.nexray.eu.cc/search/youtube | prexzyapis.com/search/youtube (POST)
 *            api.omegatech.app/api/Search/yt-mp3
 *   audio  : apis.davidcyril.name.ng (KEYED) | api.nexray.eu.cc/downloader/ytplay
 *            api.omegatech.app/api/download/yt-dl
 *   video  : apis.davidcyril.name.ng /download/ytmp4 (KEYED)
 *            api.nexray.eu.cc/downloader/ytvideo | api.omegatech.app/api/download/Yt-mate
 *   nsfw img: api.waifu.pics/nsfw/* | api.rule34.xxx (JSON)
 *   nsfw dl : apis.davidcyril.name.ng (KEYED) xnxxdl / xvideosdl
 */

const DC_BASE = "https://apis.davidcyril.name.ng";
const DC_KEY  = "dc_live_DGTayILzxRyFE2rq5I2uvgUKY9ACzjoe";

const axios = require("axios");

// ─── helpers ──────────────────────────────────────────────────────────────────
function toNum(jid) { return String(jid || "").split("@")[0].replace(/[^0-9]/g, ""); }
function isUrl(t) { return /^https?:\/\//i.test(String(t || "").trim()); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pickUrl(d) {
  if (!d) return null;
  const r = d.result || d.data || d;
  if (typeof r === "string" && /^https?:\/\//i.test(r)) return r;
  return r?.download_url || r?.download || r?.url || r?.dl || r?.video || r?.audio || r?.media || r?.mp4 || r?.mp3 || null;
}
async function getJson(url, timeout = 30000) {
  const { data } = await axios.get(url, { timeout, validateStatus: () => true,
    headers: { "User-Agent": "Mozilla/5.0" } });
  return data;
}
async function dcGet(path, params = {}, timeout = 30000) {
  const qs = new URLSearchParams({ apikey: DC_KEY, ...params }).toString();
  return getJson(`${DC_BASE}${path}?${qs}`, timeout);
}

// ─── YOUTUBE SEARCH (nexray -> prexzy POST -> omegatech) ─────────────────────
async function ytSearch(query) {
  // 1. nexray
  try {
    const d = await getJson(`https://api.nexray.eu.cc/search/youtube?q=${encodeURIComponent(query)}`, 15000);
    const v = d?.result?.[0] || d?.data?.[0];
    if (v && (v.url || v.id || v.link)) return {
      url: v.url || v.link || `https://youtu.be/${v.id}`,
      title: v.title, author: v.channel || v.author || "—",
      duration: v.duration || v.timestamp || "—",
      thumb: v.thumbnail || v.thumb || v.imageUrl || v.image || null,
    };
  } catch {}
  // 2. prexzy POST
  try {
    const { data } = await axios.post("https://prexzyapis.com/search/youtube", { q: query },
      { headers: { "Content-Type": "application/json" }, timeout: 15000, validateStatus: () => true });
    const v = data?.data?.[0] || data?.result?.[0];
    if (v && (v.link || v.url || v.id)) return {
      url: v.link || v.url || `https://youtu.be/${v.id}`,
      title: v.title, author: v.channel || v.author || "—",
      duration: v.duration || "—",
      thumb: v.imageUrl || v.thumbnail || v.thumb || null,
    };
  } catch {}
  // 3. omegatech
  try {
    const d = await getJson(`https://api.omegatech.app/api/Search/yt-mp3?q=${encodeURIComponent(query)}`, 15000);
    const v = d?.results?.[0] || d?.data?.[0] || d?.result?.[0];
    if (v && (v.id || v.url || v.link)) return {
      url: v.url || v.link || `https://youtu.be/${v.id}`,
      title: v.title, author: v.channel || v.author || "—",
      duration: v.duration || "—",
      thumb: v.thumbnail || v.thumb || null,
    };
  } catch {}
  return null;
}

// ─── AUDIO download URL chain (KEYED davidcyril -> nexray -> omegatech) ──────
async function audioUrl(videoUrl, query) {
  try { const d = await dcGet("/download/ytmp3", { url: videoUrl }); const u = pickUrl(d); if (u) return u; } catch {}
  try { const d = await dcGet("/download/yta",    { url: videoUrl }); const u = pickUrl(d); if (u) return u; } catch {}
  if (query) {
    try {
      const d = await getJson(`https://api.nexray.eu.cc/downloader/ytplay?q=${encodeURIComponent(query)}`, 30000);
      const r = d?.result || d?.data || d;
      const u = r?.audio || r?.download_url || r?.url || r?.dl || r?.mp3 || r?.music;
      if (u && /^https?:\/\//i.test(u)) return u;
    } catch {}
  }
  try { const d = await getJson(`https://api.omegatech.app/api/download/yt-dl?url=${encodeURIComponent(videoUrl)}&format=mp3`, 30000); const u = pickUrl(d); if (u) return u; } catch {}
  try { const d = await getJson(`https://api.omegatech.app/api/download/Yt-mate?url=${encodeURIComponent(videoUrl)}&type=audio`, 30000); const u = pickUrl(d); if (u) return u; } catch {}
  return null;
}

// ─── VIDEO download URL chain (KEYED davidcyril -> nexray -> omegatech) ──────
async function videoUrlDl(videoUrl) {
  try { const d = await dcGet("/download/ytmp4", { url: videoUrl }); const u = pickUrl(d); if (u) return u; } catch {}
  try { const d = await getJson(`https://api.nexray.eu.cc/downloader/ytvideo?url=${encodeURIComponent(videoUrl)}`, 30000); const u = pickUrl(d); if (u) return u; } catch {}
  try { const d = await getJson(`https://api.nexray.eu.cc/downloader/v2/youtube?url=${encodeURIComponent(videoUrl)}`, 30000); const u = pickUrl(d); if (u) return u; } catch {}
  try { const d = await getJson(`https://api.omegatech.app/api/download/Yt-mate?url=${encodeURIComponent(videoUrl)}&type=video`, 30000); const u = pickUrl(d); if (u) return u; } catch {}
  try { const d = await getJson(`https://api.omegatech.app/api/download/yt-dl?url=${encodeURIComponent(videoUrl)}&format=mp4`, 30000); const u = pickUrl(d); if (u) return u; } catch {}
  return null;
}

// ─── .play  (image card + ad-embed + 1-4 choices) ────────────────────────────
const PLAY_PENDING = new Map();          // choicesMsgId -> { url, title }
const PLAY_TTL = 5 * 60 * 1000;
const _boundSocks = new Set();

const AD_BRAND = "𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x PLAYER";

function playAdContext(title) {
  return { externalAdReply: {
    title: AD_BRAND,
    body: title || "YouTube Media Player",
    mediaType: 1,
    renderLargerThumbnail: true,
    sourceUrl: "https://github.com/precious125588",
  } };
}

async function playCmd(sock, msg, args) {
  const jid = msg.key.remoteJid;
  const q = (args || []).join(" ").trim();
  if (!q) return sock.sendMessage(jid, { text: `🎵 *${AD_BRAND}*\n\nUsage: .play <song name or YouTube URL>` }, { quoted: msg });

  let info = isUrl(q)
    ? { url: q, title: q, author: "—", duration: "—", thumb: null }
    : await ytSearch(q);

  if (!info || !info.url) {
    return sock.sendMessage(jid, { text: `🎵 *${AD_BRAND}*\n\n❌ No results for *${q}*` }, { quoted: msg });
  }

  // ── card (thumbnail + Author/Title/Duration + ad-embed) ──────────────────
  const caption =
`🎵 *${AD_BRAND}*
━━━━━━━━━━━━━━
👤 *Author:*   ${info.author}
🎶 *Title:*    ${info.title}
⏱️ *Duration:* ${info.duration}
━━━━━━━━━━━━━━`;

  let cardSent = null;
  try {
    if (info.thumb) {
      const buf = Buffer.from((await axios.get(info.thumb, { responseType: "arraybuffer", timeout: 12000, validateStatus: () => true })).data);
      cardSent = await sock.sendMessage(jid, { image: buf, caption, contextInfo: playAdContext(info.title) }, { quoted: msg });
    }
  } catch {}
  if (!cardSent) {
    cardSent = await sock.sendMessage(jid, { text: caption, contextInfo: playAdContext(info.title) }, { quoted: msg });
  }

  // ── choices message (ad-embedded) ────────────────────────────────────────
  const choicesText =
`🎵 *${AD_BRAND}*
━━━━━━━━━━━━━━
*Reply (quote) to this message with the number of your choice:*

1. Audio Type
2. Audio Document
3. Voice note
4. Video Type
━━━━━━━━━━━━━━
_Reply within 5 minutes._`;

  const choiceMsg = await sock.sendMessage(jid, { text: choicesText, contextInfo: playAdContext(info.title) }, { quoted: msg });
  if (choiceMsg?.key?.id) {
    PLAY_PENDING.set(choiceMsg.key.id, { url: info.url, title: info.title, query: q });
    setTimeout(() => PLAY_PENDING.delete(choiceMsg.key.id), PLAY_TTL);
  }
  bindPlayListener(sock);
}

function bindPlayListener(sock) {
  if (!sock?.ev || _boundSocks.has(sock)) return;
  _boundSocks.add(sock);
  sock.ev.on("messages.upsert", async (ev) => {
    if (ev.type !== "notify") return;
    for (const m of ev.messages || []) {
      try { await onPlayChoice(sock, m); } catch {}
    }
  });
}

async function onPlayChoice(sock, m) {
  if (!m?.message) return;
  const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (!quotedId) return;
  const pending = PLAY_PENDING.get(quotedId);
  if (!pending) return;
  const body = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
  if (!/^[1-4]$/.test(body)) return;
  PLAY_PENDING.delete(quotedId);

  const jid = m.key.remoteJid;
  const choice = Number(body);
  await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } }).catch(() => {});
  const title = pending.title || "media";
  const safeName = title.replace(/[^\w\s.-]/g, "_").trim().slice(0, 50) || "media";

  if (choice === 4) {
    // VIDEO — robust ytmate-style chain
    const vUrl = await videoUrlDl(pending.url);
    if (!vUrl) { await sock.sendMessage(jid, { text: `🎵 *${AD_BRAND}*\n\n❌ All video providers failed.\n🔗 ${pending.url}` }, { quoted: m }); return; }
    try {
      const buf = Buffer.from((await axios.get(vUrl, { responseType: "arraybuffer", timeout: 180000, maxContentLength: 200 * 1024 * 1024, validateStatus: () => true })).data);
      try {
        await sock.sendMessage(jid, { video: buf, mimetype: "video/mp4", caption: `🎬 ${title}` }, { quoted: m });
      } catch {
        await sock.sendMessage(jid, { document: buf, mimetype: "video/mp4", fileName: `${safeName}.mp4`, caption: `🎬 ${title}` }, { quoted: m });
      }
    } catch (e) {
      await sock.sendMessage(jid, { text: `🎵 *${AD_BRAND}*\n\n❌ Video download failed: ${e.message}` }, { quoted: m });
    }
    return;
  }

  // AUDIO (1 = play, 2 = document, 3 = voice note)
  const aUrl = await audioUrl(pending.url, pending.query);
  if (!aUrl) { await sock.sendMessage(jid, { text: `🎵 *${AD_BRAND}*\n\n❌ All audio providers failed.\n🔗 ${pending.url}` }, { quoted: m }); return; }
  try {
    const buf = Buffer.from((await axios.get(aUrl, { responseType: "arraybuffer", timeout: 180000, maxContentLength: 200 * 1024 * 1024, validateStatus: () => true })).data);
    if (choice === 2) {
      await sock.sendMessage(jid, { document: buf, mimetype: "audio/mpeg", fileName: `${safeName}.mp3`, caption: `🎵 ${title}` }, { quoted: m });
    } else if (choice === 3) {
      await sock.sendMessage(jid, { audio: buf, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: m });
    } else {
      await sock.sendMessage(jid, { audio: buf, mimetype: "audio/mpeg", ptt: false, fileName: `${safeName}.mp3` }, { quoted: m });
    }
  } catch (e) {
    await sock.sendMessage(jid, { text: `🎵 *${AD_BRAND}*\n\n❌ Audio download failed: ${e.message}` }, { quoted: m });
  }
}

// ─── .video ───────────────────────────────────────────────────────────────────
async function videoCmd(sock, msg, args) {
  const jid = msg.key.remoteJid;
  const q = (args || []).join(" ").trim();
  if (!q) return sock.sendMessage(jid, { text: `📹 *Video*\n\nUsage: .video <query or URL>` }, { quoted: msg });
  await sock.sendMessage(jid, { react: { text: "📹", key: msg.key } }).catch(() => {});
  const info = isUrl(q) ? { url: q, title: q } : await ytSearch(q);
  if (!info?.url) return sock.sendMessage(jid, { text: `📹 ❌ No results for *${q}*` }, { quoted: msg });
  const vUrl = await videoUrlDl(info.url);
  if (!vUrl) return sock.sendMessage(jid, { text: `📹 ❌ All video providers failed.\n🔗 ${info.url}` }, { quoted: msg });
  try {
    const buf = Buffer.from((await axios.get(vUrl, { responseType: "arraybuffer", timeout: 180000, maxContentLength: 200 * 1024 * 1024, validateStatus: () => true })).data);
    const safeName = (info.title || "video").replace(/[^\w\s.-]/g, "_").trim().slice(0, 50) || "video";
    try {
      await sock.sendMessage(jid, { video: buf, mimetype: "video/mp4", caption: `🎬 ${info.title}` }, { quoted: msg });
    } catch {
      await sock.sendMessage(jid, { document: buf, mimetype: "video/mp4", fileName: `${safeName}.mp4`, caption: `🎬 ${info.title}` }, { quoted: msg });
    }
  } catch (e) {
    await sock.sendMessage(jid, { text: `📹 ❌ Video download failed: ${e.message}` }, { quoted: msg });
  }
}

// ─── .getpp ───────────────────────────────────────────────────────────────────
async function getppCmd(sock, msg, args) {
  const chatJid = msg.key.remoteJid || "";
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = ctx?.mentionedJid?.[0] || ctx?.participant;
  const isGroup = chatJid.endsWith("@g.us");
  let target;

  if (mentioned) {
    target = String(mentioned).replace(/@lid$/, "@s.whatsapp.net").replace(/@c\.us$/, "@s.whatsapp.net");
  } else if (args?.[0] && /^[0-9]/.test(String(args[0]).replace(/[^0-9]/g, ""))) {
    const n = String(args[0]).replace(/[^0-9]/g, "");
    if (n.length >= 7) target = n + "@s.whatsapp.net";
  }
  // DM with no mention/number => the chat partner IS the target (always, even fromMe)
  if (!target && !isGroup) target = chatJid;
  if (!target) {
    const sender = msg.key.participant || msg.key.remoteJid;
    target = String(sender).replace(/@lid$/, "@s.whatsapp.net");
  }
  if (!target) return sock.sendMessage(chatJid, { text: "❌ Could not resolve target. Use .getpp @mention | .getpp <number> | reply | (in DM, no args = chat partner)." }, { quoted: msg });

  try {
    let pp = null;
    try { pp = await sock.profilePictureUrl(target, "image"); } catch {}
    if (!pp) { try { pp = await sock.profilePictureUrl(target, "preview"); } catch {} }
    if (!pp) return sock.sendMessage(chatJid, { text: `❌ No profile picture for +${toNum(target)} — private or not set.` }, { quoted: msg });
    const buf = Buffer.from((await axios.get(pp, { responseType: "arraybuffer", timeout: 15000, validateStatus: () => true })).data);
    await sock.sendMessage(chatJid, { image: buf }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chatJid, { text: `❌ Profile picture fetch failed. ${e.message}` }, { quoted: msg });
  }
}

// ─── .add ─────────────────────────────────────────────────────────────────────
function extractVcfNumbers(msg) {
  const out = [];
  const seen = new Set();
  const push = (num) => {
    const n = String(num || "").replace(/[^0-9]/g, "");
    if (n.length >= 7 && !seen.has(n)) { seen.add(n); out.push(n); }
  };
  const scanVcard = (vc) => {
    if (!vc) return;
    const lines = String(vc).split(/\r?\n/);
    for (const line of lines) {
      if (/^TEL/i.test(line)) { const m = line.match(/:(.*)$/); if (m) push(m[1]); }
      const w = line.match(/waid=(\d+)/i); if (w) push(w[1]);
    }
  };
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (q?.contactMessage?.vcard) scanVcard(q.contactMessage.vcard);
  if (q?.contactsArrayMessage?.contacts) for (const c of q.contactsArrayMessage.contacts) scanVcard(c.vcard);
  if (msg.message?.contactMessage?.vcard) scanVcard(msg.message.contactMessage.vcard);
  if (msg.message?.contactsArrayMessage?.contacts) for (const c of msg.message.contactsArrayMessage.contacts) scanVcard(c.vcard);
  return out;
}

async function resolveGroupJid(sock, link) {
  if (!link) return null;
  const m = String(link).match(/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]+)/i);
  if (!m) return null;
  try { const info = await sock.groupGetInviteInfo(m[1]); if (info?.id) return info.id; } catch {}
  return null;
}

async function addCmd(sock, msg, args) {
  const chatJid = msg.key.remoteJid || "";
  const isGroup = chatJid.endsWith("@g.us");
  const raw = (args || []).join(" ").trim();
  const status = async (t) => sock.sendMessage(chatJid, { text: t }, { quoted: msg });

  // gc link (optional) → target group can differ from current chat
  const linkMatch = raw.match(/https?:\/\/chat\.whatsapp\.com\/(?:invite\/)?[A-Za-z0-9]+/i);
  let groupJid = null;
  let numbersText = raw;
  if (linkMatch) {
    groupJid = await resolveGroupJid(sock, linkMatch[0]);
    if (!groupJid) return status(`➕ *Add*\n\n❌ Could not resolve the group link.\nMake sure the link is a valid WhatsApp group invite.`);
    numbersText = raw.replace(linkMatch[0], " ");
  } else if (isGroup) {
    groupJid = chatJid;
  }

  const vcfNums = extractVcfNumbers(msg);
  const typedNums = numbersText.replace(linkMatch ? linkMatch[0] : "", " ")
    .split(/[\s,;|]+/).map(s => s.replace(/[^0-9]/g, "")).filter(n => n.length >= 7);

  const numbers = [...new Set([...vcfNums, ...typedNums])].slice(0, 500);

  if (!groupJid) {
    return status(`➕ *Add*\n\nNo target group found.\n\nUsage:\n• In a group:  .add 234xxx,234yyy\n• Anywhere:   .add <gclink> 234xxx,234yyy\n• Reply .add to a VCF/contact card\n• Reply .add <gclink> to a VCF card`);
  }
  if (!numbers.length) {
    return status(`➕ *Add*\n\n❌ No numbers found. Type numbers (comma/space separated) or reply .add to a VCF/contact card.`);
  }

  const prog = await sock.sendMessage(chatJid, { text: `➕ *Add*\n\n⏳ Adding ${numbers.length} member(s) one-by-one to the group...` }, { quoted: msg });
  const progKey = prog?.key;
  const edit = async (t) => { if (progKey) { try { await sock.sendMessage(chatJid, { text: t, edit: progKey }); return; } catch {} } await status(t); };

  const results = [];
  let ok = 0;
  for (let i = 0; i < numbers.length; i++) {
    const num = numbers[i];
    const jid = num + "@s.whatsapp.net";
    try {
      const res = await sock.groupParticipantsUpdate(groupJid, [jid], "add");
      const entry = Array.isArray(res) ? res[0] : res?.[jid];
      const code = entry?.status ?? entry?.code;
      if (code === undefined || code === null || String(code) === "200" || entry === true) {
        results.push(`✅ +${num}`); ok++;
      } else if (String(code) === "409") { results.push(`ℹ️ +${num} already in group`); }
      else if (String(code) === "403") { results.push(`🔒 +${num} privacy — invite sent/failed`); }
      else if (String(code) === "404") { results.push(`❌ +${num} not on WhatsApp`); }
      else { results.push(`⚠️ +${num} (${code || "failed"})`); }
    } catch (e) {
      results.push(`❌ +${num}: ${String(e?.message || "failed").slice(0, 50)}`);
    }
    if (i < numbers.length - 1) await sleep(2500); // ban-safe pacing
  }

  const head = results.slice(0, 80).join("\n");
  const more = results.length > 80 ? `\n…and ${results.length - 80} more` : "";
  await edit(`➕ *Add — done*\n\n${head}${more}\n\n✅ ${ok}/${numbers.length} added.`);
}

// ─── NSFW (live providers only; silent dead-API replaced with clear errors) ───
async function nsfwImageCmd(category) {
  return async (sock, msg) => {
    const jid = msg.key.remoteJid;
    if (jid.endsWith("@g.us")) return sock.sendMessage(jid, { text: "🔞 Adult content is only available in private chats (DM)." }, { quoted: msg });
    await sock.sendMessage(jid, { react: { text: "🔞", key: msg.key } }).catch(() => {});
    // waifu.pics (live, images) -> rule34.xxx fallback
    try {
      const d = await getJson(`https://api.waifu.pics/nsfw/${category}`, 15000);
      const u = d?.url;
      if (u) {
        const buf = Buffer.from((await axios.get(u, { responseType: "arraybuffer", timeout: 20000, validateStatus: () => true })).data);
        return await sock.sendMessage(jid, { image: buf, caption: `🔞 *${category}*\n_18+ content_` }, { quoted: msg });
      }
      throw new Error("waifu.pics retu
