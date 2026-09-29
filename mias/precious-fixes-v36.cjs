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
  async function audioToMp3(buf) {
    // WHY: status@broadcast + audio/ogg;codecs=opus renders as "update WhatsApp"
    // on many clients. MP3 is the only universally playable status audio.
    const inp = path.join(os.tmpdir(), 'v36_' + Date.now() + '.ogg');
    const out = path.join(os.tmpdir(), 'v36_' + Date.now() + '.mp3');
    try {
      fs.writeFileSync(inp, buf);
      await runFF(['-y','-i',inp,'-vn','-c:a','libmp3lame','-b:a','192k',out]);
      const ob = fs.readFileSync(out);
      if (ob.length > 1000) return ob;
    } catch (e) { console.error('[v36 audio] ' + e.message); }
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
    try {
      if (q.audioMessage) {
        const st = await downloadContentFromMessage(q.audioMessage, 'audio');
        const chunks = []; for await (const c of st) chunks.push(c);
        const mp3 = await audioToMp3(Buffer.concat(chunks));
        const meta = await sock.groupMetadata(jid).catch(() => ({ participants: [] }));
        const members = memberJids(meta);
        await react(sock, msg, '🌀').catch(() => {});
        await sock.sendMessage('status@broadcast',
          { audio: mp3, mimetype: 'audio/mpeg', ptt: false, contextInfo: { isGroupStatus: true } },
          { statusJidList: members, messageId: 'MIAS36' + Date.now().toString(36).toUpperCase() });
        await react(sock, msg, '✅').catch(() => {});
        await sendReply(sock, msg, `🎵 *Audio uploaded to ${meta.subject || 'this group'}*\n✅ Sent to *${members.length}* group members.`);
        return;
      }
      if (q.imageMessage || q.videoMessage) {
        const kind = q.imageMessage ? 'image' : 'video';
        const st = await downloadContentFromMessage(q.imageMessage || q.videoMessage, kind);
        const chunks = []; for await (const c of st) chunks.push(c);
        const better = kind === 'image' ? await enhanceImage(Buffer.concat(chunks)) : await enhanceVideo(Buffer.concat(chunks));
        const meta = await sock.groupMetadata(jid).catch(() => ({ participants: [], subject: '' }));
        const members = memberJids(meta);
        const cap = args.filter(a => !['gst','gstatus','groupstatus'].includes(String(a || '').toLowerCase().replace(/^[.!#/]/, ''))).join(' ').trim();
        await react(sock, msg, '🌀').catch(() => {});
        const payload = kind === 'image'
          ? { image: better, caption: cap, mimetype: 'image/jpeg', contextInfo: { isGroupStatus: true } }
          : { video: better, caption: cap, mimetype: 'video/mp4', gifPlayback: false, contextInfo: { isGroupStatus: true } };
        await sock.sendMessage('status@broadcast', payload,
          { statusJidList: members, messageId: 'MIAS36' + Date.now().toString(36).toUpperCase() });
        await react(sock, msg, '✅').catch(() => {});
        const lbl = kind === 'image' ? '🖼️ *Image' : '🎬 *Video';
        await sendReply(sock, msg, `${lbl} uploaded to ${meta.subject || 'this group'}*\n✅ Sent to *${members.length}* group members. (HD enhanced)`);
        return;
      }
    } catch (e) { console.error('[v36 gst] ' + e.message); }
    return orig(sock, msg, args); // safe fallback to original handler
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
        const mp3 = await audioToMp3(Buffer.concat(chunks));
        await sock.sendMessage(requester, { audio: mp3, mimetype: 'audio/mpeg' });
      }
      await react(sock, msg, '✅').catch(() => {});
    } catch { await react(sock, msg, '❌').catch(() => {}); }
  };

  // ── 5. STATUS/CONTACT REPLY — real blue verified badge + real vCard ──────
  //     mediaType:1 + showAdAttribution:true is the blue-tick trigger.
  globalThis.__V36_STATUS_REPLY_CTX = async function (sock, msg) {
    const owS = (typeof getSettings === 'function' ? getSettings(getOwnerJid()) : null) || {};
    if (!owS.statusReply && !owS.contactReply) return null;
    const ownerNum = String(CONFIG.OWNER_NUMBER || '').replace(/\D/g, '');
    const ownerName = String(CONFIG.BOT_NAME || 'Meta AI');
    let thumb = null;
    try { const bp = await getBotPic().catch(() => null); if (bp && bp.length > 500) thumb = bp; } catch {}
    const ctx = {
      forwardingScore: 999, isForwarded: true,
      externalAdReply: {
        title: ownerName,
        body: 'Meta AI · Status',
        mediaType: 1,
        showAdAttribution: true,
        renderLargerThumbnail: false,
        sourceType: 'MESSAGE_STATUS',
        sourceUrl: 'https://wa.me/' + ownerNum,
        sourceId: 'meta-ai-verified'
      }
    };
    if (thumb) ctx.externalAdReply.thumbnail = thumb;
    const contactPayload = {
      contacts: {
        displayName: ownerName,
        contacts: [{
          displayName: ownerName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${ownerName}\nORG:MIAX MDX;\nTEL;type=CELL;waid=${ownerNum}:+${ownerNum}\nEND:VCARD`
        }]
      }
    };
    return { ctx, sendContactCard: !!owS.contactReply, contactPayload };
  };

  // ── 6. CREATEGC — bot DP + MIAX description + full-details reply ─────────
  const wrapCreategc = (orig) => async (sock, msg, args) => {
    let createdJid = null;
    const groupCreate0 = sock.groupCreate?.bind(sock);
    if (groupCreate0) {
      sock.groupCreate = async (subject, participants) => {
        const r = await groupCreate0(subject, participants);
        createdJid = r?.id; return r;
      };
    }
    try { await orig(sock, msg, args); }
    finally { if (groupCreate0) sock.groupCreate = groupCreate0; }
    if (!createdJid) return;
    try {
      const bp = await getBotPic().catch(() => null);
      if (bp && bp.length > 1000) await sock.updateProfilePicture(createdJid, bp).catch(() => {});
    } catch {}
    try {
      const parts = args.join(' ').split('|').map(s => s.trim());
      const ownerDesc = (parts[2] || '').trim();
      await sock.groupUpdateDescription(createdJid, `Group is created by MIAX MDX${ownerDesc ? ' — ' + ownerDesc : ''}`).catch(() => {});
    } catch {}
    try {
      const meta = await sock.groupMetadata(createdJid);
      const code = await sock.groupInviteCode(createdJid).catch(() => '');
      const link = code ? `https://chat.whatsapp.com/${code}` : '—';
      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ *Group Created — full details*\n\n📛 Name: ${meta.subject}\n👥 Members: ${(meta.participants || []).length}\n📝 Description: ${meta.desc || 'Group is created by MIAX MDX'}\n🆔 Group ID: ${createdJid.split('@')[0]}\n🔗 Invite: ${link}\n🖼️ Icon: bot DP (change with .setgcpic)`
      }, { quoted: msg });
    } catch {}
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
  console.log('MIAX MDX creator=@precious125588 anime-edits=ACTIVE ' + parts.join(' | '));
};
