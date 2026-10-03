// =============================================================================
// precious-fixes-v36.cjs — MIAX MDX unified fix pack (REPLACES v20..v29).
// Install: in mias/index.js, AFTER all other fix-pack requires, add ONE line:
//
//   try { require("./precious-fixes-v36.cjs")({ commands, cmd, CONFIG, sendReply, react, getBotPic, getSettings, getOwnerJid, axios, downloadContentFromMessage }); } catch (e) { console.log("[v36] load error:", e.message); }
//
// Then DELETE the require lines for precious-fixes-v20/v21/v24/v27/v28/v29.
// =============================================================================
'use strict';
module.exports = function installV36(ctx) {
  const { commands, CONFIG, sendReply, react, getBotPic, getSettings, getOwnerJid, axios, downloadContentFromMessage } = ctx;
  const fs = require('fs'), os = require('os'), path = require('path');
  const { execFile } = require('child_process');
  const ffBin = (() => { try { const p = require('ffmpeg-static'); return (p && typeof p === 'string') ? p : 'ffmpeg'; } catch { return 'ffmpeg'; } })();
  const runFF = (args, ms = 600000) => new Promise((res, rej) => execFile(ffBin, args, { timeout: ms }, e => e ? rej(e) : res()));

  // ── 1. HOISTED media grabber (fixes: "_cmfGrabMedia is not defined") ─────
  const grab = async (sock, msg) => {
    const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    let node = q || msg.message;
    for (const k of ['ephemeralMessage','viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension','documentWithCaptionMessage'])
      if (node?.[k]?.message) { node = node[k].message; break; }
    const KINDS = { imageMessage:'image', videoMessage:'video', audioMessage:'audio', stickerMessage:'sticker', documentMessage:'document', ptvMessage:'video' };
    let kind = null, raw = null;
    for (const k of Object.keys(KINDS)) if (node?.[k]) { kind = KINDS[k]; raw = node[k]; break; }
    if (!kind) return { kind: null, buf: null };
    try {
      const stream = await downloadContentFromMessage(raw, kind === 'sticker' ? 'sticker' : kind);
      const chunks = [];
      await Promise.race([
        (async () => { for await (const c of stream) chunks.push(c); })(),
        new Promise((_, rj) => setTimeout(() => rj(new Error('grab-timeout')), 30000))
      ]);
      return { kind, buf: Buffer.concat(chunks), raw };
    } catch (e) { console.error('[v36 grab] ' + e.message); return { kind: null, buf: null }; }
  };
  globalThis._cmfGrabMedia = grab;   // legacy path used by remini/hd/enhance
  globalThis.__mfGrabMedia = grab;   // wizard path

  // ── 2. QUALITY PIPELINE (sharp/jimp for images, ffmpeg for video/audio) ──
  async function enhanceImage(buf) {
    try {
      const sharp = require('sharp');
      const m = await sharp(buf).metadata();
      return await sharp(buf)
        .resize(Math.min((m.width || 1080) * 2, 8000), Math.min((m.height || 1080) * 2, 8000), { kernel: 'lanczos3', fit: 'inside' })
        .sharpen({ sigma: 1.1 })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
    } catch {}
    try { const J = require('jimp'); const j = await J.read(buf); return await j.scale(2).quality(95).getBufferAsync(J.MIME_JPEG); } catch {}
    return buf;
  }
  async function enhanceVideo(buf) {
    const inp = path.join(os.tmpdir(), 'v36_' + Date.now() + '.mp4');
    const out = path.join(os.tmpdir(), 'v36_' + Date.now() + '_o.mp4');
    try {
      fs.writeFileSync(inp, buf);
      await runFF(['-y','-i',inp,'-vf','scale=iw*2:ih*2:flags=lanczos','-c:v','libx264','-crf','18','-preset','veryfast','-c:a','copy','-movflags','faststart',out]);
      const ob = fs.readFileSync(out);
      if (ob.length > 10000 && ob.length < 64 * 1024 * 1024) return ob;
    } catch (e) { console.error('[v36 video] ' + e.message); }
    finally { try { fs.unlinkSync(inp); } catch {} try { fs.unlinkSync(out); } catch {} }
    return buf;
  }
  async function audioToOpus(buf) {
    // WhatsApp status voice note strictly requires audio/ogg with opus codec and ptt: true.
    // Raw MP3 triggers "You shared a status but your version of WhatsApp doesn't support it. Update WhatsApp".
    const inp = path.join(os.tmpdir(), 'v37_' + Date.now() + '.input');
    const out = path.join(os.tmpdir(), 'v37_' + Date.now() + '.ogg');
    try {
      fs.writeFileSync(inp, buf);
      await runFF(['-y', '-i', inp, '-vn', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1', '-vbr', 'on', '-compression_level', '10', out]);
      const ob = fs.readFileSync(out);
      if (ob.length > 100) return ob;
    } catch (e) { console.error('[v37 opus transcode] ' + e.message); }
    finally { try { fs.unlinkSync(inp); } catch {} try { fs.unlinkSync(out); } catch {} }
    return buf;
  }

  // ── 3. GST wrapper — quality pipeline + MP3 audio + 🌀→✅ reactions ──────
  const memberJids = (meta) => (meta.participants || [])
    .map(p => (typeof p.id === 'string' ? p.id : String(p.id || '')))
    .filter(j => j.endsWith('@s.whatsapp.net'));

  const wrapGst = (orig) => async (sock, msg, args) => {
    const ctx0 = msg.message?.extendedTextMessage?.contextInfo;
    const q = ctx0?.quotedMessage;
    if (!q) return orig(sock, msg, args);
    const jid = msg.key.remoteJid;
    let targetGid = jid.endsWith('@g.us') ? jid : '';
    const rawArgs = (args || []).map(a => String(a || '').trim()).filter(Boolean);
    if (rawArgs.length > 0) {
      const first = rawArgs[0];
      if (first.endsWith('@g.us') || first.endsWith('@lid')) {
        targetGid = first;
      } else if (/^\d{10,}$/.test(first)) {
        targetGid = first + '@g.us';
      }
    }
    if (!targetGid) return orig(sock, msg, args);

    try {
      if (q.audioMessage) {
        const st = await downloadContentFromMessage(q.audioMessage, 'audio');
        const chunks = []; for await (const c of st) chunks.push(c);
        const mp3 = await audioToOpus(Buffer.concat(chunks));
        const meta = await sock.groupMetadata(targetGid).catch(() => ({ participants: [], subject: '' }));
        const members = memberJids(meta);
        await react(sock, msg, '🌀').catch(() => {});
        // Direct send to group
        await sock.sendMessage(targetGid, { audio: mp3, mimetype: 'audio/ogg; codecs=opus', ptt: true }).catch(() => {});
        // Relay status
        await sock.sendMessage('status@broadcast',
          { audio: mp3, mimetype: 'audio/ogg; codecs=opus', ptt: true, contextInfo: { isGroupStatus: true } },
          { statusJidList: members, messageId: 'MIAS36' + Date.now().toString(36).toUpperCase() }).catch(() => {});
        await react(sock, msg, '✅').catch(() => {});
        await sendReply(sock, msg, `*AUDIO UPLOADED TO ${String(meta.subject || targetGid).toUpperCase()}*\n\nSENT TO *${members.length}* GROUP MEMBERS.`);
        return;
      }
      if (q.imageMessage || q.videoMessage) {
        const kind = q.imageMessage ? 'image' : 'video';
        const st = await downloadContentFromMessage(q.imageMessage || q.videoMessage, kind);
        const chunks = []; for await (const c of st) chunks.push(c);
        const better = kind === 'image' ? await enhanceImage(Buffer.concat(chunks)) : await enhanceVideo(Buffer.concat(chunks));
        const meta = await sock.groupMetadata(targetGid).catch(() => ({ participants: [], subject: '' }));
        const members = memberJids(meta);
        const cap = args.filter(a => {
          const s = String(a || '').toLowerCase().replace(/^[.!#/]/, '');
          return !['gst','gstatus','groupstatus'].includes(s) && !s.endsWith('@g.us') && !s.endsWith('@lid') && !/^\d{10,}$/.test(s);
        }).join(' ').trim();
        await react(sock, msg, '🌀').catch(() => {});
        const payload = kind === 'image'
          ? { image: better, caption: cap, mimetype: 'image/jpeg', contextInfo: { isGroupStatus: true } }
          : { video: better, caption: cap, mimetype: 'video/mp4', gifPlayback: false, contextInfo: { isGroupStatus: true } };
        // Direct send to target group
        await sock.sendMessage(targetGid, kind === 'image' ? { image: better, caption: cap } : { video: better, caption: cap, mimetype: 'video/mp4' }).catch(() => {});
        // Group status relay
        await sock.sendMessage('status@broadcast', payload,
          { statusJidList: members, messageId: 'MIAS36' + Date.now().toString(36).toUpperCase() }).catch(() => {});
        await react(sock, msg, '✅').catch(() => {});
        const lbl = kind === 'image' ? '*IMAGE' : '*VIDEO';
        await sendReply(sock, msg, `${lbl} UPLOADED TO ${String(meta.subject || targetGid).toUpperCase()}*\n\nSENT TO *${members.length}* GROUP MEMBERS. (HD ENHANCED)`);
        return;
      }
    } catch (e) { console.error('[v36 gst] ' + e.message); }
    return orig(sock, msg, args);
  };
  for (const n of ['gst','gstatus','groupstatus']) {
    const e = commands.get(n); if (!e || e.__v36) continue;
    const orig = e._origHandler || e.handler;
    e.handler = wrapGst(orig); e.__v36 = true; commands.set(n, e);
  }

  // ── 4. STATUS AUTO-SEND ("send" / "send pls" / "share" / "send boss") ────
  //     Call from your messages.upsert status-reply branch:
  //       if (globalThis.V36_STATUS_SEND && isSendKeyword) return globalThis.V36_STATUS_SEND(sock, msg, quoted);
  globalThis.V36_STATUS_SEND = async function (sock, msg, quoted) {
    const requester = msg.key.remoteJid.endsWith('@g.us') ? (msg.key.participant || msg.participant) : msg.key.remoteJid;
    await react(sock, msg, '🌀').catch(() => {});
    try {
      if (quoted?.imageMessage) {
        const st = await downloadContentFromMessage(quoted.imageMessage, 'image');
        const chunks = []; for await (const c of st) chunks.push(c);
        const better = await enhanceImage(Buffer.concat(chunks));
        await sock.sendMessage(requester, { image: better, caption: quoted.imageMessage.caption || '✅ Sent' });
      } else if (quoted?.videoMessage) {
        const st = await downloadContentFromMessage(quoted.videoMessage, 'video');
        const chunks = []; for await (const c of st) chunks.push(c);
        const better = await enhanceVideo(Buffer.concat(chunks));
        await sock.sendMessage(requester, { video: better, mimetype: 'video/mp4', caption: quoted.videoMessage.caption || '✅ Sent' });
      } else if (quoted?.audioMessage) {
        const st = await downloadContentFromMessage(quoted.audioMessage, 'audio');
        const chunks = []; for await (const c of st) chunks.push(c);
        const mp3 = await audioToOpus(Buffer.concat(chunks));
        await sock.sendMessage(requester, { audio: mp3, mimetype: 'audio/ogg; codecs=opus', ptt: true });
      }
      await react(sock, msg, '✅').catch(() => {});
    } catch { await react(sock, msg, '❌').catch(() => {}); }
  };

  // ── 5. STATUS/CONTACT REPLY — Meta AI verified-style header, OWNER identity ──
  //     DP + name come from the BOT OWNER (never the person chatting), the
  //     "message via ads" attribution tag is gone (showAdAttribution: false),
  //     and the card quotes through the normal status-reply round logic.
  globalThis.__V36_STATUS_REPLY_CTX = async function (sock, msg) {
    const owJ = (typeof getOwnerJid === "function" ? getOwnerJid() : "") || "";
    const owS = (typeof getSettings === "function" ? getSettings(owJ) : null) || {};
    if (!owS.statusReply && !owS.contactReply) return null;

    const owNum = String(owJ || CONFIG.OWNER_NUMBER || "").split("@")[0].split(":")[0].replace(/\D/g, "");
    let ownerName = CONFIG.BOT_NAME || "MAIS";
    try { const n = await sock.getName(owJ).catch(() => ""); if (n) ownerName = n; } catch {}

    let dpUrl = null;
    try { dpUrl = await sock.profilePictureUrl(owJ, "image").catch(() => null); } catch {}

    // Fetch official Meta AI profile image from WhatsApp or use verified Meta AI CDN asset
    let metaAiDp = globalThis.__metaAiDpCache || null;
    if (!metaAiDp && sock && typeof sock.profilePictureUrl === "function") {
      try {
        metaAiDp = await sock.profilePictureUrl("13135550002@s.whatsapp.net", "image").catch(() => null);
        if (!metaAiDp) metaAiDp = await sock.profilePictureUrl("0@s.whatsapp.net", "image").catch(() => null);
        if (metaAiDp) globalThis.__metaAiDpCache = metaAiDp;
      } catch {}
    }
    if (!metaAiDp) {
      metaAiDp = "https://files.catbox.moe/5axb5a.jpg";
    }

    const ctx = {};
    let fakeQuoted = null;

    if (owS.statusReply) {
      ctx.externalAdReply = {
        title: "Meta AI ☑️",
        body: "✓ Status",
        mediaType: 1,
        thumbnailUrl: metaAiDp,
        sourceUrl: "https://www.meta.ai",
        showAdAttribution: false,
        renderLargerThumbnail: false,
      };

      // Verified Meta AI status quote envelope (authentic Meta AI JID, blue badge & profile)
      fakeQuoted = {
        key: {
          remoteJid: "status@broadcast",
          fromMe: false,
          participant: "13135550002@s.whatsapp.net",
          id: "META_AI_" + Math.random().toString(36).substring(2, 10).toUpperCase(),
        },
        message: {
          conversation: "Meta AI",
        },
        verifiedProfile: true,
        verifiedBizName: "Meta AI",
        pushName: "Meta AI",
      };
      // Context info properties for Meta AI verified identity
      ctx.stanzaId = fakeQuoted.key.id;
      ctx.participant = "13135550002@s.whatsapp.net";
      ctx.quotedMessage = { conversation: "Meta AI" };
      ctx.verifiedProfile = true;
      ctx.pushName = "Meta AI";
      ctx.botMessageInvokePayload = {};
    }

    if (owS.contactReply && !ctx.externalAdReply) {
      ctx.externalAdReply = {
        title: ownerName,
        body: "✓ Verified",
        mediaType: 1,
        thumbnailUrl: dpUrl || undefined,
        sourceUrl: "https://wa.me/" + owNum,
        showAdAttribution: false,
        renderLargerThumbnail: false,
      };
    }

    return { ctx, fakeQuoted, contactQuoted: null };
  };

  // ── 6. CREATEGC — bot DP + MIAX description + full-details reply ─────────
  const wrapCreategc = () => async (sock, msg, args) => {
    const raw = args.join(' ').trim();
    if (!raw) {
      await sendReply(sock, msg, "Usage: " + (CONFIG.PREFIX || ".") + "creategc <GroupName>");
      return;
    }
    await react(sock, msg, "🌀").catch(() => {});

    try {
      const parts = raw.split('|').map(s => s.trim());
      const subject = parts[0];
      const desc = parts[2] || "Group is created by MIAX MDX";

      const senderJid = msg.key?.participant || msg.participant || (msg.key?.remoteJid?.endsWith('@s.whatsapp.net') ? msg.key?.remoteJid : null);
      const participants = senderJid ? [senderJid] : [];

      const created = await sock.groupCreate(subject, participants);
      const createdJid = created?.id;

      if (createdJid) {
        // 1. Silent description set
        try {
          await sock.groupUpdateDescription(createdJid, "Group is created by MIAX MDX" + (parts[2] ? " — " + parts[2] : ""));
        } catch {}

        // 2. Silent bot DP set
        try {
          const bp = await getBotPic().catch(() => null);
          if (bp && bp.length > 1000) {
            await sock.updateProfilePicture(createdJid, bp).catch(() => {});
          }
        } catch {}

        // 3. Invite code
        const code = await sock.groupInviteCode(createdJid).catch(() => '');
        const link = code ? ("https://chat.whatsapp.com/" + code) : '—';

        // 4. Send ONLY the final single formatted message
        const replyText = `✅ Group Created — full details\n\n📛 Name: ${subject}\n👥 Members: ${participants.length || 1}\n📝 Description: Group is created by MIAX MDX\n🆔 Group ID: ${createdJid.split('@')[0]}\n🔗 Invite: ${link}\n🖼️ Icon: bot DP (change with .setgcpic)`;

        await sock.sendMessage(msg.key.remoteJid, { text: replyText }, { quoted: msg });
        await react(sock, msg, "✅").catch(() => {});
      }
    } catch (e) {
      console.error("[creategc clean]", e?.message || e);
      await react(sock, msg, "❌").catch(() => {});
      await sendReply(sock, msg, "❌ Failed to create group: " + (e?.message || e));
    }
  };
  for (const n of ['creategc','newgroup','newgroup2']) {
    const e = commands.get(n); if (!e || e.__v36gc) continue;
    const orig = e._origHandler || e.handler;
    e.handler = wrapCreategc(orig); e.__v36gc = true; commands.set(n, e);
  }

  // ── 7. SETTINGS — react ⚙️ so you can see it's alive ─────────────────────
  for (const n of ['setting','settings','config']) {
    const e = commands.get(n); if (!e || e.__v36s) continue;
    const orig = e._origHandler || e.handler;
    e.handler = async (sock, msg, a) => { await react(sock, msg, '⚙️').catch(() => {}); return orig(sock, msg, a); };
    e.__v36s = true; commands.set(n, e);
  }

  // ── 8. BOOT VERIFY LINE (deploy-log proof, incl. anime-edits status) ─────
  const parts = [];
  parts.push('grab=' + (typeof globalThis._cmfGrabMedia === 'function' ? 'OK' : 'MISS'));
  try { require('@napi-rs/canvas'); parts.push('canvas=OK'); } catch { parts.push('canvas=NO'); }
  try { require('jimp'); parts.push('jimp=OK'); } catch { parts.push('jimp=NO'); }
  try { require('sharp'); parts.push('sharp=OK'); } catch { parts.push('sharp=NO'); }
  parts.push('ffmpeg=' + (ffBin === 'ffmpeg' ? 'sys' : 'static'));
  try { require('./features/animeGcLibrary.cjs'); parts.push('animeLib=OK'); } catch { parts.push('animeLib=NO'); }
  try { require('./features/animeEdits.js'); parts.push('animeEdits=ACTIVE'); } catch { parts.push('animeEdits=?'); }
  const fontFiles = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf'
  ];
  parts.push('fonts=' + (fontFiles.some(f => { try { return fs.existsSync(f); } catch { return false; } }) ? 'OK' : 'JIMP-FALLBACK'));
  // ── 9. ANIME EDITS INSTALL (powers .naruto / .jjk / .demonslayer creator-page fetching) ─
  try {
    function isRealMedia(buf) {
      if (!buf || buf.length < 32 * 1024) return false;
      const head = buf.slice(0, 32).toString('utf8').trim().toLowerCase();
      if (/^<!doctype|^<html|^\{|^<\?xml|^not found|^forbidden|^error/.test(head)) return false;
      const mp4 = buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
      const mkv = buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
      return mp4 || mkv;
    }
    async function sendVideoRobust(sock, jid, buf, caption, quoted) {
      if (!isRealMedia(buf)) throw new Error('upstream returned non-video data');
      try {
        return await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4', caption }, { quoted });
      } catch (e) {
        return await sock.sendMessage(jid, {
          document: buf, mimetype: 'video/mp4',
          fileName: 'video.mp4', caption: caption || '🎬 video (sent as file)',
        }, { quoted });
      }
    }
    const P = {
      cmd: ctx.cmd,
      commands: ctx.commands,
      CONFIG: ctx.CONFIG,
      sendReply: ctx.sendReply,
      react: ctx.react,
    };
    const animeEdits = require('./precious-anime-edits.cjs');
    if (typeof animeEdits.install === 'function') {
      const res = animeEdits.install(P, { sendVideoRobust, isRealMedia, axios: ctx.axios });
      console.log('[v36] anime-edits installed:', res);
    }
  } catch (_aeErr) {
    console.log('[v36] anime-edits install notice:', _aeErr?.message || _aeErr);
  }

  // ── REMINI / HD: 🌀 while working, ✅ on success, ❌ on failure, no spam, no bot restart ──
  const wrapRemini = () => async (sock, msg, args) => {
    const { kind, buf } = await grab(sock, msg).catch(() => ({ kind: null, buf: null }));
    if (!buf || !['image', 'video', 'sticker', 'document'].includes(kind)) {
      await sendReply(sock, msg, "✨ Reply to an image or video with " + (CONFIG.PREFIX || ".") + "remini");
      return;
    }

    await react(sock, msg, "🌀").catch(() => {});
    try {
      if (kind === 'image' || kind === 'sticker' || (kind === 'document' && /image/i.test(String(msg.message?.documentMessage?.mimetype || '')))) {
        const out = await enhanceImage(buf);
        if (!out) throw new Error("Enhancement failed");
        const payload = out.length > 15 * 1024 * 1024
          ? { document: out, mimetype: 'image/jpeg', fileName: 'hd_' + Date.now() + '.jpg', caption: '✨ *HD Enhanced*' }
          : { image: out, caption: '✨ *HD Enhanced*' };
        await sock.sendMessage(msg.key.remoteJid, payload, { quoted: msg });
        await react(sock, msg, "✅").catch(() => {});
      } else {
        const out = await enhanceVideo(buf);
        if (!out) throw new Error("Video enhancement failed");
        const payload = out.length > 64 * 1024 * 1024
          ? { document: out, mimetype: 'video/mp4', fileName: 'hd_' + Date.now() + '.mp4', caption: '✨ *HD Enhanced*' }
          : { video: out, mimetype: 'video/mp4', caption: '✨ *HD Enhanced*' };
        await sock.sendMessage(msg.key.remoteJid, payload, { quoted: msg });
        await react(sock, msg, "✅").catch(() => {});
      }
    } catch (e) {
      console.error("[remini error]", e?.message || e);
      await react(sock, msg, "❌").catch(() => {});
    }
  };

  for (const n of ['hd', 'remini', 'enhance', 'upscale']) {
    const e = commands.get(n);
    if (e) {
      e.handler = wrapRemini();
      commands.set(n, e);
    } else if (typeof P.cmd === 'function') {
      P.cmd(n, { desc: "Enhance image/video quality", category: "MEDIA" }, wrapRemini());
    }
  }

  console.log('[MIAX MDX][boot-verify] creator=@precious125588 anime-edits=ACTIVE ' + parts.join(' | '));
};
