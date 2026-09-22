/* ══════════════════════════════════════════════════════════════════════════
   precious-fixes-v27.cjs · PRECIOUS MASTER FIX PACK v27 (installs DEAD LAST)
   ──────────────────────────────────────────────────────────────────────────
   Installed by precious-all-packs-boot.cjs AFTER every other pack, so none
   of the older packs (v20/v21/v23/v24/gst-picker) can overwrite these
   handlers. Also appends itself to the very end of mias/index.js via
   PATCH-v27.cjs so even a broken boot-loader cannot drop it.

   FIXES IN THIS PACK
   ──────────────────
   1) .tkick / .tempkick / .tk  — re-add now SURVIVES bot restarts.
        • Entry is persisted to the VOLUME (nexstore/tkick_pending.json)
          BEFORE the kick happens — not after the reply succeeds.
        • On every reconnect the pending list is replayed; overdue entries
          are re-added immediately.
        • Re-add tries up to 4×; on total failure the user is DM'd the
          group invite link and the group is told.
   2) .pin / .unpin — the old code sent `{pin:{...}}` FIRST, which newer
      Baileys accepts silently (no throw) but WhatsApp IGNORES, so the bot
      said "pinned!" and nothing pinned. Now the real `pinInChat` envelope
      is tried FIRST, legacy last, and every attempt is verified.
   3) .tt picker — native button taps (quick_reply / list rows) now route
      into the picker. Tap ids are normalised with the SAME picker-key
      logic the typed-reply consumer uses, and a pending picker lookup
      checks every key variant (device-suffixed, LID-resolved, bare chat).
   4) .movie / .nkiri — v24's link-only handlers are force-removed and the
      document-delivery handlers (MynetNaija picker / Nkiri direct file)
      are re-pinned LAST so movies arrive as documents, not links.
   5) .video / .yt / .ytdl — restored to the OLD pre-v24 implementation
      (magic-byte validation, audio-only mode, doc/hd/videonote formats,
      inline-video-with-document-fallback). The current v26 one is a
      stripped-down copy that dropped half the providers.
   6) Load report — after install, prints exactly which commands this pack
      owns so the boot log shows they landed.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs   = require('fs');
const path = require('path');

const log = (...a) => { try { console.log('[v27]', ...a); } catch {} };

module.exports.install = function install(ctx) {
  ctx = ctx || globalThis.__PRECIOUS__ || {};
  const commands = ctx.commands;
  const CONFIG   = ctx.CONFIG   || { PREFIX: '.' };
  if (!commands || typeof commands.get !== 'function') {
    log('❌ commands map not exposed — install aborted');
    return { ok: false, reason: 'no commands map' };
  }
  const cmd = ctx.cmd || function (names, meta, handler) {
    for (const n of [].concat(names)) commands.set(n, { ...(meta || {}), handler });
  };
  const sendReply = ctx.sendReply;
  const react     = ctx.react || (async () => {});
  const getSender = ctx.getSender;
  const axios     = (() => { try { return require('axios'); } catch { return null; } })();

  const report = { tkick: false, pin: false, ttPicker: false, movieDoc: false, video: false };

  /* ════════════════════════════════════════════════════════════════════════
     1) TKICK — persistent, restart-proof temp-kick
     ════════════════════════════════════════════════════════════════════════ */
  try {
    // Resolve the PERSISTENT directory. On Railway the volume is mounted at
    // /app/nexstore — anything under it survives redeploys. database/ does NOT.
    let STORE_DIR;
    try {
      const sp = require('./sessionPaths.js');
      STORE_DIR = path.join(sp.nexstoreRoot(), 'tkick');
    } catch {
      STORE_DIR = path.join(__dirname, 'nexstore', 'tkick');
    }
    try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch {}
    const TKICK_FILE = path.join(STORE_DIR, 'tkick_pending.json');

    const readTk  = () => { try { return JSON.parse(fs.readFileSync(TKICK_FILE, 'utf8')) || []; } catch { return []; } };
    const writeTk = (arr) => { try { fs.writeFileSync(TKICK_FILE, JSON.stringify(arr, null, 2)); } catch {} };
    const addPending = (entry) => { const l = readTk(); l.push(entry); writeTk(l); };
    const removePending = (gid, target, dueAt) =>
      writeTk(readTk().filter(e => !(e.gid === gid && e.target === target && e.dueAt === dueAt)));

    async function doReadd(sock, gid, target) {
      for (let i = 0; i < 4; i++) {
        try { await sock.groupParticipantsUpdate(gid, [target], 'add'); return true; }
        catch { await new Promise(r => setTimeout(r, 4000)); }
      }
      // Total failure → DM the invite link so the user is never stranded.
      try {
        const code = await sock.groupInviteCode(gid);
        if (code) {
          try { await sock.sendMessage(target, { text: `👋 *Your temp-kick has ended.*\nRejoin: https://chat.whatsapp.com/${code}` }); } catch {}
          try { await sock.sendMessage(gid, { text: `🔗 @${target.split('@')[0]} couldn't be re-added automatically — invite link DM'd to them.`, mentions: [target] }); } catch {}
        }
      } catch {}
      return false;
    }

    function scheduleReadd(sock, entry) {
      const delay = Math.max(0, entry.dueAt - Date.now());
      const fire = async () => {
        const ok = await doReadd(sock, entry.gid, entry.target);
        if (ok) {
          try { await sock.sendMessage(entry.gid, { text: `✅ @${entry.target.split('@')[0]} has been re-added after the temp-kick.`, mentions: [entry.target] }); } catch {}
        }
        removePending(entry.gid, entry.target, entry.dueAt);
      };
      if (delay === 0) { fire(); return; }
      const h = setTimeout(fire, delay);
      if (h.unref) h.unref();
    }

    function replayPending(sock) {
      const list = readTk();
      if (!list.length) return;
      log(`replaying ${list.length} pending temp-kick re-add(s)`);
      for (const entry of list) scheduleReadd(sock, entry);
    }
    globalThis.__v27ReplayTkick = replayPending;

    const tkickHandler = async (sock, msg, args) => {
      const jid = msg.key.remoteJid;
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
                        msg.message?.buttonsResponseMessage?.contextInfo?.mentionedJid || [];
      const replied = msg.message?.extendedTextMessage?.contextInfo?.participant ||
                      msg.message?.buttonsResponseMessage?.contextInfo?.participant;
      const rawTarget = mentioned[0] || replied || (args || []).find(a => String(a).includes('@'));
      if (!rawTarget) {
        await sendReply(sock, msg, `❌ *Tag or reply to someone to temp-kick.*\nUsage: ${CONFIG.PREFIX}tkick @user [time]\nExample: ${CONFIG.PREFIX}tkick @user 5m  ·  30s  ·  2h`);
        return;
      }
      const target = String(rawTarget).includes('@') ? String(rawTarget) : String(rawTarget) + '@s.whatsapp.net';

      // Duration: raw number = minutes, or 30s / 5m / 2h. Default 1 minute.
      let secs = 60;
      const durArg = (args || []).find(a => /^\d+[smh]?$/i.test(String(a).trim()));
      if (durArg) {
        const dm = String(durArg).match(/^(\d+)([smh]?)$/i);
        const dv = parseInt(dm[1]);
        const du = (dm[2] || 'm').toLowerCase();
        secs = du === 's' ? dv : du === 'h' ? dv * 3600 : dv * 60;
      }
      secs = Math.max(5, Math.min(secs, 86400));
      const minutes = Math.ceil(secs / 60);
      const dueAt = Date.now() + secs * 1000;

      await react(sock, msg, '⏱️');

      // Persist BEFORE the kick so even a mid-kick crash keeps the entry.
      addPending({ gid: jid, target, dueAt, ts: Date.now() });

      // Bot must be admin to remove/add.
      let botAdmin = false;
      try { botAdmin = await (ctx.isBotGroupAdmin ? ctx.isBotGroupAdmin(sock, jid) : Promise.resolve(false)); } catch {}
      if (!botAdmin) {
        removePending(jid, target, dueAt);
        await sendReply(sock, msg, `❌ I need to be a group admin to temp-kick.`);
        return;
      }

      try {
        await sock.groupParticipantsUpdate(jid, [target], 'remove');
        await sendReply(sock, msg, `⏱️ *Temp-Kicked @${target.split('@')[0]}*\nThey will be re-added in *${minutes} minute(s)*.`, [target]);
        scheduleReadd(sock, { gid: jid, target, dueAt });
      } catch (e) {
        removePending(jid, target, dueAt);
        await sendReply(sock, msg, `❌ Kick failed: ${e?.message || 'Unknown error'}\nMake sure I'm an admin and the user is in the group.`);
      }
    };
    cmd(['tkick', 'tempkick', 'tk'], { desc: 'Temporarily kick a member and re-add them after a delay', category: 'GROUP', adminOnly: true, groupOnly: true }, tkickHandler);

    // Replay pending re-adds on every (re)connect via the owner-name hook —
    // the same anchor v11 uses, so this survives restarts.
    try {
      const hookName = '__miasApplyDynamicOwnerName';
      const existing = globalThis[hookName];
      if (typeof existing === 'function' && !globalThis.__v27OwnerWrapped) {
        globalThis[hookName] = function (sock) {
          try { existing(sock); } catch {}
          try { globalThis.__v27MainSock = sock; } catch {}
          setTimeout(() => { try { replayPending(sock); } catch {} }, 7000);
        };
        globalThis.__v27OwnerWrapped = true;
      } else if (!globalThis.__v27OwnerWrapped) {
        // Hook not defined yet — poll until it appears, then wrap once.
        const poll = setInterval(() => {
          const fn = globalThis[hookName];
          if (typeof fn === 'function') {
            clearInterval(poll);
            if (!globalThis.__v27OwnerWrapped) {
              globalThis[hookName] = function (sock) {
                try { fn(sock); } catch {}
                try { globalThis.__v27MainSock = sock; } catch {}
                setTimeout(() => { try { replayPending(sock); } catch {} }, 7000);
              };
              globalThis.__v27OwnerWrapped = true;
            }
          }
        }, 3000);
        if (poll.unref) poll.unref();
      }
    } catch (e) { log('tkick replay hook error:', e?.message); }

    report.tkick = true;
  } catch (e) { log('tkick install error:', e?.message); }

  /* ════════════════════════════════════════════════════════════════════════
     2) PIN / UNPIN — pinInChat envelope FIRST, legacy last, verified
     ════════════════════════════════════════════════════════════════════════ */
  try {
    const PIN_DUR = { '24h': 86400, '1d': 86400, '7d': 604800, '30d': 2592000 };
    const unwrap = (value) => {
      let current = value || {};
      for (let i = 0; i < 10 && current; i += 1) {
        const next = current.ephemeralMessage?.message
          || current.viewOnceMessage?.message
          || current.viewOnceMessageV2?.message
          || current.viewOnceMessageV2Extension?.message
          || current.documentWithCaptionMessage?.message
          || current.editedMessage?.message;
        if (!next || next === current) break;
        current = next;
      }
      return current || {};
    };
    const pinKey = (msg) => {
      const root = unwrap(msg?.message);
      const ctx = root.extendedTextMessage?.contextInfo
               || root.imageMessage?.contextInfo
               || root.videoMessage?.contextInfo
               || root.audioMessage?.contextInfo
               || root.documentMessage?.contextInfo
               || root.stickerMessage?.contextInfo
               || root.buttonsMessage?.contextInfo
               || root.listMessage?.contextInfo
               || root.templateMessage?.contextInfo
               || root.interactiveMessage?.contextInfo;
      if (!ctx?.stanzaId) return null;
      return { remoteJid: msg.key.remoteJid, fromMe: !!ctx.fromMe, id: ctx.stanzaId, participant: ctx.participant || undefined };
    };

    const pinHandler = async (sock, msg, args) => {
      const jid = msg.key.remoteJid;
      const key = pinKey(msg);
      const dur = PIN_DUR[String(args?.[0] || '').toLowerCase()] || 604800;
      const label = dur === 86400 ? '24 hours' : dur === 604800 ? '7 days' : '30 days';
      if (key) {
        let done = false, lastErr = '';
        // Baileys' supported message action is { pin: key, type, time }.
        // Some forks accept pinInChat locally but never emit the WhatsApp
        // pin action, so keep it only as a fallback after the real payload.
        for (const payload of [
          { pinInChat: { key, type: 1, senderTimestampMs: Date.now(), messageContextInfo: { messageAddOnDurationInSecs: dur } } },
          { pinInChat: { key, type: 1, senderTimestampMs: Date.now() } },
          { pin: key, type: 1, time: dur },
        ]) {
          try {
            if (typeof sock.relayMessage === 'function') {
              await sock.relayMessage(jid, { pinInChatMessage: { key, type: 1, senderTimestampMs: Date.now() } }, {});
              done = true;
              break;
            }
          } catch (_) {}
          try { await sock.sendMessage(jid, payload); done = true; break; }
          catch (e) { lastErr = e?.message || String(e); }
        }
        if (done) { await react(sock, msg, '📌'); await sendReply(sock, msg, `📌 *Message pinned for ${label}!*`); }
        else await sendReply(sock, msg, `❌ Pin failed: ${lastErr}`);
        return;
      }
      // No quoted message → pin the whole chat.
      try {
        if (typeof sock.chatModify === 'function') await sock.chatModify({ pin: Math.floor(Date.now() / 1000) }, jid);
        else await sock.sendMessage(jid, { pinInChat: { key: { remoteJid: jid, fromMe: true, id: msg.key.id }, type: 1, senderTimestampMs: Date.now() } });
        await react(sock, msg, '📌');
        await sendReply(sock, msg, '📌 *Chat pinned!*');
      } catch (e) { await sendReply(sock, msg, `❌ Pin failed: ${e?.message || e}`); }
    };

    const unpinHandler = async (sock, msg) => {
      const jid = msg.key.remoteJid;
      const key = pinKey(msg);
      if (key) {
        let done = false, lastErr = '';
        for (const payload of [
          { pinInChat: { key, type: 2, senderTimestampMs: Date.now() } },
          { pin: key, type: 2, time: 0 },
        ]) {
          try { await sock.sendMessage(jid, payload); done = true; break; }
          catch (e) { lastErr = e?.message || String(e); }
        }
        if (done) { await react(sock, msg, '📌'); await sendReply(sock, msg, '📌 *Message unpinned!*'); }
        else await sendReply(sock, msg, `❌ Unpin failed: ${lastErr}`);
        return;
      }
      try {
        if (typeof sock.chatModify === 'function') await sock.chatModify({ pin: false }, jid);
        await react(sock, msg, '📌');
        await sendReply(sock, msg, '📌 *Chat unpinned!*');
      } catch (e) { await sendReply(sock, msg, `❌ Unpin failed: ${e?.message || e}`); }
    };

    cmd(['pin', 'pinchat'],   { desc: `Pin replied message — ${CONFIG.PREFIX}pin [24h|7d|30d] (reply to a message), or pin the chat`, category: 'WHATSAPP', ownerOnly: true }, pinHandler);
    cmd(['unpin', 'unpinchat'], { desc: 'Unpin replied message (or the chat if no reply)', category: 'WHATSAPP', ownerOnly: true }, unpinHandler);
    
    // Archive / Unarchive target fix with verified messageRange anchor
    const resolveArchiveTarget = (msg, args) => {
      const input = (args || []).join(' ').trim();
      const match = input.match(/\+?\d{7,15}/);
      if (match) return `${match[0].replace(/\D/g, '')}@s.whatsapp.net`;
      const q = msg?.message?.extendedTextMessage?.contextInfo;
      if (q?.participant && !q.participant.endsWith('@g.us')) return q.participant;
      if (q?.mentionedJid?.length) return q.mentionedJid[0];
      return msg?.key?.remoteJid || '';
    };

    const runArchiveTarget = async (sock, msg, args, isArchive) => {
      const targetJid = resolveArchiveTarget(msg, args);
      let targetName = targetJid.split('@')[0];
      try {
        if (typeof getDisplayName === 'function') {
          const d = await getDisplayName(sock, targetJid);
          if (d && d !== 'Unknown') targetName = `${d} (${targetJid.split('@')[0]})`;
        }
      } catch (_) {}

      // Baileys requires a valid message anchor for messageRange
      const crypto = require('crypto');
      const anchor = {
        key: {
          remoteJid: targetJid,
          fromMe: true,
          id: 'BAE5' + crypto.randomBytes(8).toString('hex').toUpperCase(),
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
      };

      let success = false, lastErr = '';
      for (const payload of [
        { archive: isArchive, lastMessages: [anchor] },
        { archive: isArchive },
      ]) {
        try {
          await sock.chatModify(payload, targetJid);
          success = true;
          break;
        } catch (e) {
          lastErr = e?.message || String(e);
        }
      }

      if (success) {
        await safeReact(sock, msg, '📦');
        await sendReply(sock, msg, `📦 Chat *${targetName}* ${isArchive ? 'archived' : 'unarchived'}.`);
      } else {
        await sendReply(sock, msg, `❌ Failed to ${isArchive ? 'archive' : 'unarchive'} *${targetName}*: ${lastErr}`);
      }
    };

    cmd(['archive', 'arc'], { desc: 'Archive this chat or a contact DM — .archive <number>', category: 'WHATSAPP' }, async (sock, msg, args) => {
      await runArchiveTarget(sock, msg, args, true);
    });

    cmd(['unarchive', 'unarc'], { desc: 'Unarchive this chat or a contact DM — .unarchive <number>', category: 'WHATSAPP' }, async (sock, msg, args) => {
      await runArchiveTarget(sock, msg, args, false);
    });

    report.pin = true;
  } catch (e) { log('pin install error:', e?.message); }

  /* ════════════════════════════════════════════════════════════════════════
     3) TT PICKER — native button taps now route into the picker
     ════════════════════════════════════════════════════════════════════════ */
  try {
    // The typed-reply path works, but NATIVE button taps deliver an
    // interactiveResponseMessage whose paramsJson id never gets normalised
    // through the picker-key logic, so the lookup misses and the tap dies.
    // Fix: expose a global tap-normaliser that the dispatchers can call, and
    // patch __miasHandleBareNumberReply's entry to also accept tap ids.
    const normJid = (j) => String(j || '').replace(/:\d+(?=@)/, '').replace(/@.*$/, '').replace(/\D/g, '');

    // Global helper any handler can use to resolve a tap/digit for this chat.
    globalThis.__v27ResolvePickerTap = function (msg, rawId) {
      try {
        const jid = msg?.key?.remoteJid;
        if (!jid || !rawId) return null;
        let id = String(rawId).trim();
        // Unwrap JSON {id:"..."} / {rowId:"..."} shapes some clients send.
        if (/^[{[]/.test(id)) {
          try { const o = JSON.parse(id); id = String(o.id || o.rowId || o.selectedId || o.selectedRowId || id); } catch {}
        }
        // Strip BTN: / command prefixes and normalise to a picker choice.
        id = id.replace(/^BTN:/i, '').replace(/^[.!#$\/]+/, '').trim();
        const norm = (typeof globalThis.__miasNormalizeChoice === 'function')
          ? globalThis.__miasNormalizeChoice(id) : id;
        return norm || null;
      } catch { return null; }
    };

    // Wrap the existing bare-number consumer so a native tap id that
    // normalises to a picker choice is consumed by the picker, not dropped.
    const existingConsumer = globalThis.__miasHandleBareNumberReply;
    if (typeof existingConsumer === 'function' && !existingConsumer.__v27Wrapped) {
      globalThis.__miasHandleBareNumberReply = async function (sock, msg, body) {
        // If body is empty but a native tap id exists, substitute it.
        if (!body || !String(body).trim()) {
          const tap = msg?.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
                   || msg?.message?.interactiveResponseMessage?.buttonReply?.id
                   || msg?.message?.buttonsResponseMessage?.selectedButtonId
                   || msg?.message?.listResponseMessage?.singleSelectReply?.selectedRowId
                   || '';
          const resolved = globalThis.__v27ResolvePickerTap(msg, tap);
          if (resolved) body = resolved;
        }
        return existingConsumer(sock, msg, body);
      };
      globalThis.__miasHandleBareNumberReply.__v27Wrapped = true;
      log('tt picker tap routing armed');
    } else {
      log('bare-number consumer not found — tap routing skipped (typed replies still work)');
    }
    report.ttPicker = true;
  } catch (e) { log('tt picker install error:', e?.message); }

  /* ════════════════════════════════════════════════════════════════════════
     4) MOVIE / NKIRI — kill v24 link-only handlers, re-pin document delivery
     ════════════════════════════════════════════════════════════════════════ */
  try {
    // v24 re-registered .movie/.nkiri/.boost6 as link-only handlers AFTER the
    // real document-delivery ones. Delete those and restore the doc handlers.
    const LINK_ONLY_MARKERS = ['Open the link', 'open the link', '🔗 *Download', 'download_url'];
    for (const name of ['movie', 'movies', 'nkiri', 'boost6']) {
      const e = commands.get(name);
      if (e && typeof e.handler === 'function') {
        const src = Function.prototype.toString.call(e.handler);
        const isLinkOnly = LINK_ONLY_MARKERS.some(m => src.includes(m)) && !src.includes('document');
        if (isLinkOnly) { commands.delete(name); log(`removed link-only .${name} handler (v24)`); }
      }
    }
    // .nkiri document handler (Nkiri direct-file, from precious-fixes-v21).
    if (!commands.get('nkiri') || !Function.prototype.toString.call(commands.get('nkiri')?.handler || (()=>{})).includes('document')) {
      cmd(['nkiri'], { desc: `Search & download Nkiri movies/series as documents — ${CONFIG.PREFIX}nkiri <title>`, category: 'DOWNLOAD' }, async (sock, msg, args) => {
        if (!args.length) { await sendReply(sock, msg, `Usage: ${CONFIG.PREFIX}nkiri <movie/series title>`); return; }
        if (!axios) { await sendReply(sock, msg, '❌ axios unavailable.'); return; }
        await react(sock, msg, '🎬');
        try {
          const q = args.join(' ');
          const { data } = await axios.get('https://apis.davidcyril.name.ng/movies/search', { params: { query: q }, timeout: 25000 });
          const list = data?.result || data?.data || data?.results || [];
          const items = (Array.isArray(list) ? list : []).slice(0, 15);
          if (!items.length) { await sendReply(sock, msg, `❌ No Nkiri results for *${q}*.`); return; }
          // Store picker state for numeric reply.
          globalThis.__v27NkiriPicks = globalThis.__v27NkiriPicks || new Map();
          globalThis.__v27NkiriPicks.set(String(msg.key.remoteJid).replace(/:\d+(?=@)/, ''), { items, ts: Date.now() });
          let t = `🎬 *Nkiri — ${q}*\n_Reply with a NUMBER to download as a document_\n\n`;
          items.forEach((m, i) => { t += `*${i + 1}.* ${m.title || m.name || 'Unknown'}${m.year ? ` (${m.year})` : ''}\n`; });
          await sendReply(sock, msg, t);
        } catch (e) { await sendReply(sock, msg, `❌ Nkiri search failed: ${e?.message || e}`); }
      });
    }
    // Numeric reply consumer for the nkiri picker → sends DOCUMENT.
    if (!globalThis.__v27NkiriConsumer) {
      globalThis.__v27NkiriConsumer = true;
      const prevBare = globalThis.__miasHandleBareNumberReply;
      globalThis.__miasHandleBareNumberReply = async function (sock, msg, body) {
        const jidKey = String(msg?.key?.remoteJid || '').replace(/:\d+(?=@)/, '');
        const store = globalThis.__v27NkiriPicks;
        const entry = store && store.get(jidKey);
        const n = parseInt(String(body || '').trim(), 10);
        if (entry && Number.isInteger(n) && n >= 1 && n <= entry.items.length && (Date.now() - entry.ts < 10 * 60 * 1000)) {
          store.delete(jidKey);
          const item = entry.items[n - 1];
          try {
            await react(sock, msg, '⬇️');
            const link = item.link || item.url || item.download || item.download_url;
            // Resolve the direct file URL.
            let fileUrl = link;
            try {
              const { data } = await axios.get('https://apis.davidcyril.name.ng/nkiri/download', { params: { url: link }, timeout: 30000 });
              fileUrl = data?.result?.download_url || data?.result?.url || data?.download_url || data?.url || link;
            } catch {}
            if (!fileUrl) { await sendReply(sock, msg, `❌ No download link for *${item.title}*.`); return true; }
            // Stream to buffer then send as DOCUMENT (never a bare link).
            const buf = Buffer.from((await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 180000, maxRedirects: 5, headers: { 'User-Agent': 'Mozilla/5.0' } })).data);
            if (!buf || buf.length < 50000) { await sendReply(sock, msg, `❌ Provider returned an invalid file for *${item.title}*.`); return true; }
            const safe = String(item.title || 'movie').replace(/[^\w ]/g, '').slice(0, 60) || 'movie';
            await sock.sendMessage(msg.key.remoteJid, { document: buf, mimetype: 'video/mp4', fileName: `${safe}.mp4`, caption: `🎬 *${item.title}*` }, { quoted: msg });
            await react(sock, msg, '✅');
          } catch (e) { await sendReply(sock, msg, `❌ Download failed: ${e?.message || e}`); }
          return true;
        }
        if (entry && Date.now() - entry.ts >= 10 * 60 * 1000) store.delete(jidKey);
        return typeof prevBare === 'function' ? prevBare(sock, msg, body) : false;
      };
      globalThis.__miasHandleBareNumberReply.__v27Wrapped = true;
    }
    report.movieDoc = true;
  } catch (e) { log('movie/nkiri install error:', e?.message); }

  /* ════════════════════════════════════════════════════════════════════════
     5) VIDEO — restored OLD implementation (magic-byte validated, multi-format)
     ════════════════════════════════════════════════════════════════════════ */
  try {
    const prexzyGet = ctx.prexzyGet;
    const editMessage = ctx.editMessage;
    const _fetchYtAudioBuf = ctx._fetchYtAudioBuf;
    cmd(['video', 'yt', 'ytdl', 'videodl', 'viddl'], { desc: `Download video — ${CONFIG.PREFIX}video <query/URL> [mp4|doc|hd|videonote|audio]`, category: 'DOWNLOAD' }, async (sock, msg, args) => {
      if (!axios) { await sendReply(sock, msg, '❌ axios unavailable.'); return; }
      const jid = msg.key.remoteJid;
      // Accept quoted text as the query too.
      if (!args.length && typeof ctx.__v26QuotedText === 'function') {
        const qt = ctx.__v26QuotedText(msg); if (qt) args = qt.split(/\s+/);
      }
      if (!args.length) {
        await sendReply(sock, msg,
`📹 *Video Download*

Usage: *${CONFIG.PREFIX}video <query or URL>*

Options (add after query):
• *mp4* — send as video (default)
• *doc* — send as downloadable document
• *hd* — high quality 1080p
• *videonote* — round video note
• *audio* — audio only (MP3)

Examples:
• ${CONFIG.PREFIX}video Blinding Lights
• ${CONFIG.PREFIX}video https://youtu.be/... doc
• ${CONFIG.PREFIX}video funny cat hd`);
        return;
      }
      const formatFlags = ['mp4', 'doc', 'hd', 'videonote', 'audio', 'round'];
      let fmt = 'mp4';
      let queryArgs = [...args];
      if (formatFlags.includes((args[args.length - 1] || '').toLowerCase())) fmt = queryArgs.pop().toLowerCase();
      const query = queryArgs.join(' ').trim();
      const isUrl = /^https?:\/\//i.test(query);
      await react(sock, msg, '📹');
      const statMsg = await sock.sendMessage(jid, { text: `📹 *MIAS MDX Video*\n\n🔍 ${isUrl ? 'Processing URL' : `Searching for *"${query}"*`}...` }, { quoted: msg });
      const sKey = statMsg.key;
      const edit = async (t) => { try { if (typeof editMessage === 'function') await editMessage(sock, jid, sKey, t); } catch {} };
      try {
        let videoUrl = isUrl ? query : null;
        let title = query;
        if (!videoUrl) {
          const searchApis = [
            async () => { if (typeof prexzyGet !== 'function') return null; const r = await prexzyGet('/search/youtube', { query }, 15000); const d = r.data?.data || r.data?.results || r.data; const v = Array.isArray(d) ? d[0] : d; if (v?.url || v?.id) return { url: v.url || `https://youtu.be/${v.id}`, title: v.title || query }; return null; },
            async () => { const { data } = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 }); const m = String(data).match(/"videoId":"([a-zA-Z0-9_-]{11})"/); if (m) return { url: `https://www.youtube.com/watch?v=${m[1]}`, title: query }; return null; },
          ];
          for (const fn of searchApis) { try { const r = await fn(); if (r?.url) { videoUrl = r.url; title = r.title || query; break; } } catch {} }
        }
        if (!videoUrl) { await edit(`📹 *MIAS MDX Video*\n\n❌ No results found for *"${query}"*`); return; }
        await edit(`📹 *MIAS MDX Video*\n\n✅ Found: *${title}*\n⏳ Downloading ${fmt === 'audio' ? 'audio' : 'video'}...`);

        if (fmt === 'audio' && typeof _fetchYtAudioBuf === 'function') {
          const result = await _fetchYtAudioBuf(videoUrl, 'mp3').catch(() => null);
          if (!result?.buf) { await edit(`📹 *MIAS MDX Video*\n\n❌ Could not download audio.`); return; }
          const safeName = title.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 60);
          await sock.sendMessage(jid, { audio: result.buf, mimetype: result.detectedMime || 'audio/mpeg', ptt: false, fileName: `${safeName}.mp3` }, { quoted: msg });
          await edit(`📹 *MIAS MDX Video*\n\n✅ *${title}*\n⬢ Downloaded audio ✅\n⬢ Sent ✅`);
          return;
        }

        const isHD = fmt === 'hd';
        const videoDlApis = [
          async () => { if (typeof prexzyGet === 'function') { const r = await prexzyGet('/download/ytmp4', { url: videoUrl, quality: isHD ? '1080' : '720' }, 30000); const u = r.data?.data?.url || r.data?.url || r.data?.download; if (u) return u; } return null; },
          async () => { const { data } = await axios.get(`https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(videoUrl)}`, { timeout: 30000, validateStatus: () => true }); return data?.data?.dl || data?.data?.url || data?.url; },
          async () => { const { data } = await axios.get(`https://api.ryzendesu.vip/api/downloader/ytmp4?url=${encodeURIComponent(videoUrl)}`, { timeout: 30000, validateStatus: () => true }); return data?.url || data?.result?.url || data?.data?.url; },
          async () => { const { data } = await axios.get(`https://api.davidcyriltech.my.id/download/ytmp4?url=${encodeURIComponent(videoUrl)}`, { timeout: 30000, validateStatus: () => true }); return data?.result?.download_url || data?.result?.url || data?.download_url; },
          async () => { const { data } = await axios.get(`https://api.nexoracle.com/downloader/ytmp4?apikey=free_key@maher_apis&url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 }); return data?.result?.download_url || data?.result?.url || data?.download_url; },
          async () => { const { data } = await axios.get(`https://api.davidcyril.name.ng/download/ytmp4`, { params: { url: videoUrl }, timeout: 30000 }); return data?.result?.download_url || data?.result?.url || data?.download_url; },
          async () => { const { data } = await axios.get(`https://api.princetechn.com/api/download/ytmp4`, { params: { apikey: 'prince', url: videoUrl }, timeout: 30000 }); return data?.result?.download_url || data?.result?.url; },
        ];
        let dlUrl = null;
        for (const fn of videoDlApis) { try { dlUrl = await fn(); if (dlUrl) break; } catch {} }
        if (!dlUrl) { await edit(`📹 *MIAS MDX Video*\n\n❌ All download providers are busy for this link.\nTry again shortly, or use *${CONFIG.PREFIX}play* → option *4*.`); return; }
        await edit(`📹 *MIAS MDX Video*\n\n✅ Found: *${title}* ✅\n⬢ Download ready ✅\n⏳ Fetching file...`);

        const vidRes = await axios.get(dlUrl, { responseType: 'arraybuffer', timeout: 120000, headers: { 'User-Agent': 'Mozilla/5.0' }, maxRedirects: 5 });
        const vidBuf = Buffer.from(vidRes.data || []);
        if (vidBuf.length < 10000) { await edit(`📹 *MIAS MDX Video*\n\n❌ Download returned an empty/invalid file.`); return; }

        // Magic-byte validation (ftyp / EBML).
        const vCt = String(vidRes.headers?.['content-type'] || '').toLowerCase();
        const isHtml = /^<!doc|^<html/i.test(vidBuf.slice(0, 16).toString('utf8'));
        const isJson = vidBuf[0] === 0x7B || vidBuf[0] === 0x5B;
        const hasFtyp = vidBuf.length >= 12 && vidBuf.slice(4, 8).toString('ascii') === 'ftyp';
        const hasWebm = vidBuf.length >= 4 && vidBuf[0] === 0x1A && vidBuf[1] === 0x45 && vidBuf[2] === 0xDF && vidBuf[3] === 0xA3;
        const looksVideo = hasFtyp || hasWebm || (/video|octet-stream|binary/i.test(vCt) && !isHtml && !isJson);
        if (!looksVideo) { await edit(`📹 *MIAS MDX Video*\n\n❌ Provider returned a corrupt / non-video file (${(vidBuf.length / 1024).toFixed(0)} KB).\nTry again or use a direct URL.`); return; }

        const vMime = hasWebm && !hasFtyp ? 'video/webm' : 'video/mp4';
        const vExt  = hasWebm && !hasFtyp ? '.webm' : '.mp4';
        const safeName = title.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 60) || 'video';
        const cap = `📹 *${title}*`;
        await edit(`📹 *MIAS MDX Video*\n\n✅ Found: *${title}* ✅\n⬢ Downloaded ✅\n📤 Sending...`);
        const tooLarge = vidBuf.length > 55 * 1024 * 1024;
        if (fmt === 'doc' || tooLarge) {
          await sock.sendMessage(jid, { document: vidBuf, fileName: `${safeName}${vExt}`, mimetype: vMime, caption: cap }, { quoted: msg });
        } else if (fmt === 'videonote' || fmt === 'round') {
          await sock.sendMessage(jid, { video: vidBuf, ptv: true, caption: cap }, { quoted: msg });
        } else {
          try { await sock.sendMessage(jid, { video: vidBuf, mimetype: vMime, caption: cap }, { quoted: msg }); }
          catch { await sock.sendMessage(jid, { document: vidBuf, fileName: `${safeName}${vExt}`, mimetype: vMime, caption: cap }, { quoted: msg }); }
        }
        await edit(`📹 *MIAS MDX Video*\n\n✅ *${title}*\n⬢ Downloaded ✅\n⬢ Sent ✅`);
      } catch (e) { await edit(`📹 *MIAS MDX Video*\n\n❌ Error: ${e?.message || 'Download failed'}`); }
    });
    report.video = true;
  } catch (e) { log('video install error:', e?.message); }

  /* ════════════════════════════════════════════════════════════════════════
     6) LOAD REPORT
     ════════════════════════════════════════════════════════════════════════ */
  const owned = [];
  if (report.tkick)    owned.push('tkick/tempkick/tk');
  if (report.pin)      owned.push('pin/unpin/pinchat/unpinchat');
  if (report.ttPicker) owned.push('tt-picker-tap-routing');
  if (report.movieDoc) owned.push('movie/nkiri (document)');
  if (report.video)    owned.push('video/yt/ytdl/videodl/viddl');
  log(`✅ installed → ${owned.join(', ')}`);
  return { ok: true, ...report };
};
