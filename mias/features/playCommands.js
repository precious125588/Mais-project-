import axios from "axios";
// Play commands moved out of mias/index.js. Handler code is unchanged.
// Each install function receives its dependencies through `ctx` from index.js.

export function installPlayCards(ctx) {
  const { _P2_BOUND, _p2OnMsg, sendReply, CONFIG, react, _p2YtId, dcGet, extractDcPlay, ytSearch, require, _p2Dur, _p2Views, _p2ThumbBuf, _p2Sweep, _p2MarkChatPending, _P2_PENDING, _p2NormJid, getSender, _P2_TTL, cmd, axios, editMessage, _p2VideoBuf, toxicCall, APIs } = ctx;
  // urlToBuffer was called by the play handlers but never defined (ReferenceError).
  // Defined here so the play card and play2 paths can fetch thumbnails and media.
  const urlToBuffer = async (url) => Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 20000, maxRedirects: 5 })).data);
function _p2Bind(sock) {
  try {
    if (!sock || !sock.ev || typeof sock.ev.on !== 'function') return;
    if (_P2_BOUND.has(sock)) return;
    _P2_BOUND.add(sock);
    sock.ev.on('messages.upsert', async function (evt) {
      if (!evt || evt.type !== 'notify') return;
      for (const m of (evt.messages || [])) {
        try { await _p2OnMsg(sock, m); } catch (e) { console.log('[play2] picker error:', e && e.message); }
      }
    });
    console.log('[play2] format-picker listener attached');
  } catch (e) {
    console.log('[play2] bind failed:', e && e.message);
  }
}

/* ── .play ─────────────────────────────────────────────────────────────────── */

const _p2PlayCardImpl = async (sock, msg, args) => {
  {
    const __rdl = (typeof globalThis.__RDL_PLAY_CARD__ === 'function') ? globalThis.__RDL_PLAY_CARD__ : null;
    if (__rdl) return __rdl(sock, msg, args);
  }
  const jid = msg.key.remoteJid;
  if (!args || !args.length) {
    await sendReply(sock, msg,
      '🎧 *' + CONFIG.BOT_NAME + ' PLAYER*\n\n' +
      'Usage: ' + CONFIG.PREFIX + 'play <song name or link>\n' +
      'Then quote the card with 1, 2, 3 or 4:\n' +
      '  1 = Audio   2 = Document   3 = Voice   4 = Video');
    return;
  }
  const query = args.join(' ').trim();
  const isUrl = /^https?:\/\//i.test(query);
  await react(sock, msg, '🎧').catch(function () {});

  const status = await sock.sendMessage(jid, {
    text: '🎧 *' + CONFIG.BOT_NAME + ' Player*\n\n🔍 Searching *' + query + '* …',
  }, { quoted: msg }).catch(function () { return null; });

  let meta = null;
  try {
    if (isUrl) {
      const vid = _p2YtId(query);
      const attempts = [
        function () { return dcGet('/download/ytmp3', { url: query }, 30000); },
        function () { return dcGet('/play', { query: query }, 30000); },
      ];
      if (vid) attempts.push(function () { return dcGet('/play', { query: 'https://www.youtube.com/watch?v=' + vid }, 30000); });
      for (const a of attempts) {
        try {
          const r = await a();
          const d = r && r.ok ? extractDcPlay(r.data) : null;
          if (d && (d.title || d.dlUrl)) {
            meta = { ...d, videoUrl: d.videoUrl || query, videoId: _p2YtId(d.videoUrl || query) };
            break;
          }
        } catch (e) {}
      }
    } else {
      try {
        const r = await dcGet('/play', { query: query }, 30000);
        const d = r && r.ok ? extractDcPlay(r.data) : null;
        if (d && (d.title || d.dlUrl)) meta = { ...d, videoId: _p2YtId(d.videoUrl) };
      } catch (e) {}
      if (!meta) {
        try {
          const res = await ytSearch(query);
          const v = res && res[0];
          if (v && v.url) meta = { title: v.title || query, videoUrl: v.url, videoId: _p2YtId(v.url) };
        } catch (e) {}
      }
    }
  } catch (e) {
    console.log('[play2] metadata error:', e && e.message);
  }

  if (!meta) meta = { title: query, videoUrl: isUrl ? query : '', videoId: _p2YtId(query) };
  if (!meta.videoUrl && meta.videoId) meta.videoUrl = 'https://www.youtube.com/watch?v=' + meta.videoId;

  // DavidCyril /play does not return the channel name, and /download/ytmp3
  // returns neither duration nor views. Fill only the blanks from yt-search so
  // the card never shows "Unknown / N/A" for a real track.
  if (!meta.artists && !meta.author || !meta.duration || !meta.views) {
    try {
      const ys = require('yt-search');
      const q = meta.videoId ? { videoId: meta.videoId } : (meta.title || query);
      const r = await ys(q);
      const v = meta.videoId ? r : (r && r.videos && r.videos[0]);
      if (v) {
        if (!meta.title) meta.title = v.title || meta.title;
        if (!meta.artists && !meta.author) meta.author = (v.author && v.author.name) || v.author || null;
        if (!meta.duration) meta.duration = (v.timestamp || (v.duration && v.duration.timestamp)) || meta.duration;
        if (!meta.views) meta.views = v.views || meta.views;
        if (!meta.thumbUrl && v.thumbnail) meta.thumbUrl = v.thumbnail;
        if (!meta.videoUrl && v.url) meta.videoUrl = v.url;
        if (!meta.videoId && v.videoId) meta.videoId = v.videoId;
      }
    } catch (e) { /* card still renders with what DavidCyril gave us */ }
  }

  const title = meta.title || query;
  const author = meta.artists || meta.author || meta.channel || 'Unknown';
  const card = [
    '🎧 *' + CONFIG.BOT_NAME + ' — PLAYER*',
    '',
    '🎵 *Title:*     ' + title,
    '👤 *Author:*    ' + author,
    '⏱️ *Duration:*  ' + _p2Dur(meta.duration),
    '👁️ *Views:*     ' + _p2Views(meta.views),
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '📥 *Choose a format — quote THIS message with the number:*',
    '',
    '  1️⃣  *Audio* — playable audio',
    '  2️⃣  *Document* — .mp3 file to download',
    '  3️⃣  *Voice* — voice note',
    '  4️⃣  *Video* — mp4 with sound',
    '',
    '_Example: reply to this card with_ `1` _for audio, `4` _for video._',
  ].join('\n');

  const thumb = await _p2ThumbBuf(meta).catch(function () { return null; });
  const sent = thumb
    ? await sock.sendMessage(jid, { image: thumb, caption: card }, { quoted: msg }).catch(function () { return null; })
    : await sock.sendMessage(jid, { text: card }, { quoted: msg }).catch(function () { return null; });

  if (status && status.key) { try { await sock.sendMessage(jid, { delete: status.key }); } catch (e) {} }

  if (!sent || !sent.key || !sent.key.id) {
    await sendReply(sock, msg, '❌ Could not send the player card for *' + title + '*.');
    return;
  }

  _p2Sweep();
  try { _p2MarkChatPending(jid, true); } catch {}
  _P2_PENDING.set(sent.key.id, {
    jid: _p2NormJid(jid),
    user: (typeof getSender === 'function' ? String(getSender(msg) || '') : ''),
    ts: Date.now(),
  });
  const _p2Timer = setTimeout(function () { _P2_PENDING.delete(sent.key.id); }, _P2_TTL);
  if (typeof _p2Timer.unref === 'function') _p2Timer.unref();
  _p2Bind(sock);
  await react(sock, msg, '✅').catch(function () {});
};

// The .play command entry (kept, so help/menu listings still show .play).
// disabled by v21 dedupe: legacy .play registration removed in favor of precious-fixes-v21
cmd(["play_legacy_disabled", "music_legacy_disabled", "song_legacy_disabled"], { desc: "Legacy disabled", category: "DOWNLOAD" }, _p2PlayCardImpl);

// Registrar used by the late re-registration block near the end of the file,
// which is what actually makes the card handler win over older overrides.
function _p2ResolveCardRegistrar() { return (typeof globalThis.__RDL_PLAY_HANDLER__ === "function") ? globalThis.__RDL_PLAY_HANDLER__ : _p2PlayCardImpl; }

cmd(["playvid","playvideo","vidplay"], { desc: "Download song as video (mp4)", category: "DOWNLOAD" }, async (sock, msg, args) => {
  if (!args.length) { await sendReply(sock, msg, `❌ Usage: ${CONFIG.PREFIX}playvid <song name or YouTube URL>`); return; }
  await react(sock, msg, "🎬");
  const query = args.join(" ").trim();
  const isUrl = /^https?:\/\//i.test(query);
  const jid = msg.key.remoteJid;
  const statusMsg = await sock.sendMessage(jid, { text: `🎬 *${CONFIG.BOT_NAME} Video Player*\n\n🔍 Searching *"${query}"*...` }, { quoted: msg });
  const sKey = statusMsg.key;
  try {
    let videoUrl = isUrl ? query : null, title = query, thumb = null;
    if (!isUrl) {
      // Search for video URL
      const _searchApis = [
        async () => { const { data } = await axios.get(`${CONFIG.GIFTED_API}/api/search/ytsearch?apikey=${CONFIG.GIFTED_KEY}&q=${encodeURIComponent(query)}`, { timeout: 15000 }); const v = data?.result?.[0] || data?.results?.[0]; if (v?.url) return { url: v.url, title: v.title, thumb: v.thumbnail }; },
        async () => { const { data } = await axios.get(`https://api.siputzx.my.id/api/y/search?query=${encodeURIComponent(query)}`, { timeout: 15000 }); const v = data?.data?.[0]; if (v?.url) return { url: v.url, title: v.title, thumb: v.thumbnail }; },
        async () => { const results = await ytSearch(query); if (results?.[0]?.url) return { url: results[0].url, title: results[0].title, thumb: results[0].thumbnail }; },
      ];
      for (const sf of _searchApis) { try { const r = await sf(); if (r?.url) { videoUrl = r.url; title = r.title || query; thumb = r.thumb; break; } } catch {} }
    }
    if (!videoUrl) { await editMessage(sock, jid, sKey, `🎬 *${CONFIG.BOT_NAME} Video Player*\n\n❌ No results for *"${query}"*`); return; }
    await editMessage(sock, jid, sKey, `🎬 *${CONFIG.BOT_NAME} Video Player*\n\n🔍 Found: *${title}*\n⏳ Downloading video...`);

    // Send thumbnail if available
    if (thumb) { try { const _tb = Buffer.from((await axios.get(thumb, { responseType: "arraybuffer", timeout: 10000 })).data); await sock.sendMessage(jid, { image: _tb, caption: `🎬 *${title}*\n_Downloading video..._` }, { quoted: msg }); } catch {} }

    let vBuf = null;
    try { vBuf = await _p2VideoBuf({ videoUrl, title, videoId: _p2YtId(videoUrl) || "" }); } catch {}

    if (vBuf && vBuf.length > 10000) {
      const safeTitle = String(title || "video").replace(/[^\w\s.-]/g, "_").trim().slice(0, 60) || "video";
      try {
        await sock.sendMessage(jid, { video: vBuf, mimetype: "video/mp4", caption: `🎬 *${title}*` }, { quoted: msg });
      } catch {
        await sock.sendMessage(jid, { document: vBuf, mimetype: "video/mp4", fileName: `${safeTitle}.mp4`, caption: `🎬 *${title}*` }, { quoted: msg });
      }
      await editMessage(sock, jid, sKey, `🎬 *${CONFIG.BOT_NAME} Video Player*\n\n✅ *${title}* sent!`);
      await react(sock, msg, "✅");
    } else {
      await editMessage(sock, jid, sKey, `🎬 *${CONFIG.BOT_NAME} Video Player*\n\n❌ All video providers failed.\n🔗 ${videoUrl}`);
      await react(sock, msg, "❌");
    }
  } catch (e) {
    await editMessage(sock, jid, sKey, `🎬 *Video Player Error:* ${e?.message || e}`).catch(() => {});
    await react(sock, msg, "❌");
  }
});

cmd(["play2", "playdoc", "songdoc"], { desc: "Play song delivered as a downloadable document (mp3 file)", category: "DOWNLOAD" }, async (sock, msg, args) => {
  if (!args.length) return sendReply(sock, msg, `❌ Usage: ${CONFIG.PREFIX}play2 <song name>`);
  await react(sock, msg, "🎼");
  const query = args.join(" ").trim();
  const isUrl = /^https?:\/\//i.test(query);
  const jid = msg.key.remoteJid;
  const statusMsg = await sock.sendMessage(jid, { text: `🎼 *${CONFIG.BOT_NAME} Player (Doc)*\n\n🔍 Searching for *"${query}"*...` }, { quoted: msg });
  const statusKey = statusMsg.key;
  try {
    // NEXORA FAST PATH — direct MP3 document (highest priority, query-only)
    let title = query, artist = "", thumb = null, videoUrl = isUrl ? query : null;
    if (!isUrl) {
      try {
        const nexRes = await dcGet("/play", { query }, 30000);
        const nex = nexRes.ok ? nexRes.data : null;
        if (nex?.status && nex?.result?.download_url) {
          const nexAudio = await axios.get(nex.result.download_url, {
            responseType: "arraybuffer", timeout: 600000, maxContentLength: Infinity, maxBodyLength: Infinity, maxRedirects: 5,
            headers: { "User-Agent": "Mozilla/5.0" }
          });
          const nexBuf = Buffer.from(nexAudio.data || []);
          if (nexBuf.length > 8000) {
            title = (nex.result.title || query).slice(0, 80);
            const fileName = `${title.replace(/[^\w\s.-]/g, "_").slice(0, 60)}.mp3`;
            await sock.sendMessage(jid, {
              document: nexBuf, fileName, mimetype: "audio/mpeg",
              caption: `🎼 *${title}*\n📁 Sent as document — tap to download.`,
            }, { quoted: msg });
            await editMessage(sock, jid, statusKey, `🎼 *${CONFIG.BOT_NAME} Player (Doc)*\n\n✅ *${title}* sent as document!`);
            return;
          }
        }
      } catch {}
    }

    // FAST PATH — toxicapis ytmp3 returns a direct CDN URL
    try {
      const tox = (await toxicCall("/download/ytmp3", { url: isUrl ? query : "", q: isUrl ? "" : query }))
                || (await toxicCall("/d/ytmp3",       { url: isUrl ? query : "", q: isUrl ? "" : query }));
      if (tox?.url) {
        const buf = await urlToBuffer(tox.url).catch(() => null);
        if (buf && buf.length > 8000) {
          title = (tox.title || query).slice(0, 80);
          const fileName = `${title.replace(/[^\w\s.-]/g, "_").slice(0, 60)}.mp3`;
          await sock.sendMessage(jid, {
            document: buf, fileName, mimetype: "audio/mpeg",
            caption: `🎼 *${title}*\n📁 Sent as document — tap to download.`,
          }, { quoted: msg });
          await editMessage(sock, jid, statusKey, `🎼 *${CONFIG.BOT_NAME} Player (Doc)*\n\n✅ *${title}* sent as document!`);
          return;
        }
      }
    } catch {}

    // 1) Resolve a YouTube URL via the same search APIs play() uses
    if (!videoUrl) {
      const searchApis = [
        async () => { const { data } = await axios.get(`${CONFIG.GIFTED_API}/api/search/ytsearch?apikey=${CONFIG.GIFTED_KEY}&q=${encodeURIComponent(query)}`, { timeout: 15000 }); const v = data?.result?.[0] || data?.results?.[0]; if (v?.url || v?.link) return { url: v.url || v.link, title: v.title || query, thumb: v.thumbnail }; },
        async () => { const { data } = await axios.get(`https://api.siputzx.my.id/api/y/search?query=${encodeURIComponent(query)}`, { timeout: 15000 }); const v = data?.data?.[0] || data?.result?.[0]; if (v?.url || v?.link) return { url: v.url || v.link, title: v.title || query, thumb: v.thumbnail }; },
        async () => { const r = await ytSearch(query); if (r?.[0]?.url) return { url: r[0].url, title: r[0].title || query, thumb: r[0].thumbnail }; },
        async () => { const { data } = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }, timeout: 15000 }); const m = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/); if (m) return { url: `https://www.youtube.com/watch?v=${m[1]}`, title: query }; },
      ];
      for (const fn of searchApis) {
        try { const r = await fn(); if (r?.url) { videoUrl = r.url; title = r.title || query; thumb = r.thumb || null; break; } } catch {}
      }
      if (!videoUrl) {
        await editMessage(sock, jid, statusKey, `🎼 *${CONFIG.BOT_NAME} Player (Doc)*\n\n🔍 Searching for *"${query}"*... ✅\n❌ No results found`);
        return;
      }
    }
    await editMessage(sock, jid, statusKey, `🎼 *${CONFIG.BOT_NAME} Player (Doc)*\n\n🔍 Searching for *"${query}"*... ✅\n📌 Found: *${title}*\n⏳ Downloading audio...`);

    // 2) Same proven dlApis as play() — no ytdl-core (YT blocks shared IPs)
    // v4.9.5 FIX: cobalt entries updated to match the working URLs from play():
    //   co.wuk.sh/api/json is the community mirror (old root / was retired),
    //   api.cobalt.tools/api/json has the correct sub-path.
    const dlApis = [
      // PRIMARY: DavidCyril
      async () => { const r = await dcGet("/download/ytmp3", { url: videoUrl }, 30000); const d = r?.ok ? extractDcPlay(r.data) : null; return d?.dlUrl || null; },
      async () => { const r = await dcGet("/play", { query: videoUrl }, 30000); const d = r?.ok ? extractDcPlay(r.data) : null; return d?.dlUrl || null; },
      async () => {
        const { data } = await axios.post("https://co.wuk.sh/api/json",
          { url: videoUrl, downloadMode: "audio", audioFormat: "mp3", filenameStyle: "basic" },
          { headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, timeout: 30000 });
        return data?.url || data?.audio;
      },
      async () => {
        const { data } = await axios.post("https://cobalt-api.kwiatekmiki.com/",
          { url: videoUrl, downloadMode: "audio", audioFormat: "mp3" },
          { headers: { Accept: "application/json", "Content-Type": "application/json" }, timeout: 30000 });
        return data?.url;
      },
      async () => {
        const { data } = await axios.post("https://api.cobalt.tools/api/json",
          { url: videoUrl, downloadMode: "audio", audioFormat: "mp3" },
          { headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, timeout: 30000 });
        return data?.url || data?.audio;
      },
      async () => {
        const { data } = await axios.get(
          `https://api.axeel.my.id/api/download/audio?url=${encodeURIComponent(videoUrl)}`,
          { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000 });
        return data?.downloadUrl || data?.url || data?.result?.url || data?.data?.url;
      },
      async () => {
        const videoId = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
        if (!videoId) return;
        const { data } = await axios.get(
          `https://api.vevioz.com/api/button/mp3/${videoId}`,
          { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,application/json" }, timeout: 25000 });
        if (typeof data === "string") { const m = data.match(/href="(https?:\/\/[^"]+\.mp3[^"]*)"/); if (m) return m[1]; }
        return data?.url;
      },
      async () => { const id = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]; if (!id) return; const { data } = await axios.get(`https://inv.nadeko.net/api/v1/videos/${id}`, { timeout: 20000 }); const a = data?.adaptiveFormats?.find(f => f.type?.includes("audio") && f.url); return a?.url; },
      async () => { const { data } = await axios.get(`https://p.oceansaver.in/ajax/download.php?format=mp3&url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 }); if (data?.success && data?.download) return data.download; },
      async () => { const { data } = await axios.get(`${CONFIG.GIFTED_API}/api/download/ytmp3?apikey=${CONFIG.GIFTED_KEY}&url=${encodeURIComponent(videoUrl)}`, { timeout: 60000 }); if (data?.success && data?.result) return data.result.download_url || data.result.url || data.result.audio || data.result.mp3; },
      async () => { const r = await APIs.getEliteProTechDownloadByUrl(videoUrl); return r?.download; },
      async () => { const r = await APIs.getYupraDownloadByUrl(videoUrl); return r?.download; },
      async () => { const r = await APIs.getOkatsuDownloadByUrl(videoUrl); return r?.download; },
      async () => { const r = await APIs.getIzumiDownloadByUrl(videoUrl); return r?.download; },
      async () => { const { data } = await axios.get(`https://api.ssyoutube.com/v2/?url=${encodeURIComponent(videoUrl)}`, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 20000 }); const a = data?.audio?.find(x => x.url) || data?.links?.find(l => l.url && l.type === "audio"); return a?.url; },
    ];

    let sent = false;
    for (const tryDl of dlApis) {
      let dlUrl = null;
      try { dlUrl = await tryDl(); } catch {}
      if (!dlUrl) continue;
      try {
        const audioRes = await axios.get(dlUrl, { responseType: "arraybuffer", timeout: 600000, maxContentLength: Infinity, maxBodyLength: Infinity, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "*/*" }, maxRedirects: 5, validateStatus: s => s >= 200 && s < 400 });
        const buf = Buffer.from(audioRes.data || []);
        const ct = String(audioRes.headers?.["content-type"] || "").toLowerCase();
        const looksHtml = buf.length >= 5 && (buf.slice(0, 5).toString("utf8").toLowerCase() === "<!doc" || buf.slice(0, 5).toString("utf8").toLowerCase() === "<html");
        const looksJson = buf.length >= 1 && (buf[0] === 0x7B || buf[0] === 0x5B);
        const hasId3      = buf.length >= 3 && buf.slice(0, 3).toString("utf8") === "ID3";
        const hasMpegSync = buf.length >= 2 && buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0;
        const hasOggS     = buf.length >= 4 && buf.slice(0, 4).toString("utf8") === "OggS";
        const hasRiff     = buf.length >= 4 && buf.slice(0, 4).toString("utf8") === "RIFF";
        const ctOk        = /audio|mpeg|mp3|ogg|m4a|aac|wav|octet-stream|binary/i.test(ct);
        const looksAudio  = hasId3 || hasMpegSync || hasOggS || hasRiff || (ctOk && !looksHtml && !looksJson);
        if (buf.length < 5000 || !looksAudio) {
          console.log(`[PLAY2] skipped corrupt buffer (len=${buf.length}, ct=${ct})`);
          continue;
        }
        // Always send as audio/mpeg .mp3 for maximum WhatsApp compatibility
        const _p2hasOggS = buf.length >= 4 && buf.slice(0, 4).toString("utf8") === "OggS";
        const _p2Mime = _p2hasOggS ? "audio/ogg" : "audio/mpeg";
        const _p2Ext = _p2hasOggS ? ".ogg" : ".mp3";
        const fileName = `${title.replace(/[^\w\s.-]/g, "_").slice(0, 60)}${_p2Ext}`;
        const thumbBuf = thumb ? await urlToBuffer(thumb).catch(() => null) : null;
        await sock.sendMessage(jid, {
          document: buf, fileName, mimetype: _p2Mime,
          caption: `🎼 *${title}*${artist ? `\n👤 ${artist}` : ""}\n📁 Sent as document — tap to download.`,
          ...(thumbBuf ? { jpegThumbnail: thumbBuf } : {}),
        }, { quoted: msg });
        await editMessage(sock, jid, statusKey, `🎼 *${CONFIG.BOT_NAME} Player (Doc)*\n\n🔍 Searching for *"${query}"*... ✅\n📌 Found: *${title}*\n⏳ Downloading audio... ✅\n📤 Sending document... ✅\n\n✅ *Done!*`);
        sent = true;
        break;
      } catch (e) { console.log("[PLAY2] provider failed:", e?.message || e); }
    }
    if (!sent) {
      await editMessage(sock, jid, statusKey, `🎼 *${CONFIG.BOT_NAME} Player (Doc)*\n\n🔍 Searching for *"${query}"*... ✅\n📌 Found: *${title}*\n⏳ Downloading audio... ❌\n\n⚠️ All audio providers failed. Try again in a bit.\n🔗 ${videoUrl}`);
    }
  } catch (e) {
    console.error("[PLAY2 ERROR]", e?.message);
    await editMessage(sock, jid, statusKey, `❌ Play2 error: ${e?.message || "could not fetch song"}`).catch(() => {});
  }
});
  return { _p2Bind, _p2PlayCardImpl, _p2ResolveCardRegistrar };
}

export function installPlayAudio(ctx) {
  const { dcGet, extractDcPlay, axios, toxicCall, CONFIG, APIs, cmd, sendReply, react, ytSearch, editMessage, __miasMapSet, sendNativeFlowButtons, __miasMapGet, __miasMapDelete, SONGS } = ctx;
const _playPickStore = new Map();
async function _fetchYtAudioBuf(videoUrl, preferFmt = "mp3") {
  const cobaltFmt = preferFmt === "m4a" ? "best" : (preferFmt === "ogg" ? "ogg" : "mp3");
  const dlApis = [
    // PRIMARY: DavidCyril
    async () => { const r = await dcGet("/download/ytmp3", { url: videoUrl }, 30000); const d = r?.ok ? extractDcPlay(r.data) : null; return d?.dlUrl || null; },
    async () => { const r = await dcGet("/play", { query: videoUrl }, 30000); const d = r?.ok ? extractDcPlay(r.data) : null; return d?.dlUrl || null; },
    async () => { const { data } = await axios.post("https://co.wuk.sh/api/json", { url: videoUrl, downloadMode: "audio", audioFormat: cobaltFmt, filenameStyle: "basic" }, { headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, timeout: 30000 }); return data?.url || data?.audio; },
    async () => { const { data } = await axios.post("https://cobalt-api.kwiatekmiki.com/", { url: videoUrl, downloadMode: "audio", audioFormat: cobaltFmt }, { headers: { Accept: "application/json", "Content-Type": "application/json" }, timeout: 30000 }); return data?.url; },
    async () => { const { data } = await axios.post("https://api.cobalt.tools/api/json", { url: videoUrl, downloadMode: "audio", audioFormat: cobaltFmt }, { headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }, timeout: 30000 }); return data?.url || data?.audio; },
    async () => { const { data } = await axios.get(`https://api.axeel.my.id/api/download/audio?url=${encodeURIComponent(videoUrl)}`, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 30000 }); return data?.downloadUrl || data?.url || data?.result?.url || data?.data?.url; },
    async () => { const id = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]; if (!id) return; const { data } = await axios.get(`https://api.vevioz.com/api/button/mp3/${id}`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,application/json" }, timeout: 25000 }); if (typeof data === "string") { const m = data.match(/href="(https?:\/\/[^"]+\.mp3[^"]*)"/); if (m) return m[1]; } return data?.url; },
    async () => { const id = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]; if (!id) return; const { data } = await axios.get(`https://inv.nadeko.net/api/v1/videos/${id}`, { timeout: 20000 }); const a = data?.adaptiveFormats?.find(f => f.type?.includes("audio") && f.url); return a?.url; },
    async () => { const { data } = await axios.get(`https://p.oceansaver.in/ajax/download.php?format=mp3&url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 }); if (data?.success && data?.download) return data.download; },
    async () => { const tox = await toxicCall("/download/ytmp3", { url: videoUrl, q: "" }); return tox?.url; },
    async () => { const { data } = await axios.get(`${CONFIG.GIFTED_API}/api/download/ytmp3?apikey=${CONFIG.GIFTED_KEY}&url=${encodeURIComponent(videoUrl)}`, { timeout: 60000 }); if (data?.success && data?.result) return data.result.download_url || data.result.url || data.result.audio || data.result.mp3; },
    async () => { const r = await APIs.getEliteProTechDownloadByUrl(videoUrl); return r?.download; },
    async () => { const r = await APIs.getYupraDownloadByUrl(videoUrl); return r?.download; },
  ];
  for (const fn of dlApis) {
    let dlUrl = null;
    try { dlUrl = await fn(); } catch {}
    if (!dlUrl) continue;
    try {
      const res = await axios.get(dlUrl, { responseType: "arraybuffer", timeout: 600000, maxContentLength: Infinity, maxBodyLength: Infinity, headers: { "User-Agent": "Mozilla/5.0" }, maxRedirects: 5, validateStatus: s => s >= 200 && s < 400 });
      const buf = Buffer.from(res.data || []);
      if (buf.length < 5000) continue;
      const ct = String(res.headers?.["content-type"] || "").toLowerCase();
      const looksHtml = buf.slice(0, 5).toString("utf8").toLowerCase().startsWith("<!doc") || buf.slice(0, 5).toString("utf8").toLowerCase().startsWith("<html");
      const hasId3      = buf.length >= 3 && buf.slice(0, 3).toString("utf8") === "ID3";
      const hasMpegSync = buf.length >= 2 && buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0;
      const hasOggS     = buf.length >= 4 && buf.slice(0, 4).toString("utf8") === "OggS";
      const hasRiff     = buf.length >= 4 && buf.slice(0, 4).toString("utf8") === "RIFF";
      const hasM4A      = buf.length >= 12 && buf.slice(4, 8).toString("ascii") === "ftyp";
      const hasWebm     = buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
      const ctOk        = /audio|mpeg|mp3|ogg|m4a|aac|wav|octet-stream|binary/i.test(ct);
      const looksAudio  = hasId3 || hasMpegSync || hasOggS || hasRiff || hasM4A || hasWebm || (ctOk && !looksHtml);
      if (!looksAudio) continue;
      // Determine detected format
      const detectedFmt = hasM4A ? "m4a" : hasOggS ? "ogg" : hasRiff ? "wav" : hasWebm ? "webm" : "mp3";
      const detectedMime = hasM4A ? "audio/mp4" : hasOggS ? "audio/ogg; codecs=opus" : hasRiff ? "audio/wav" : hasWebm ? "audio/webm" : "audio/mpeg";
      const detectedExt  = hasM4A ? ".m4a" : hasOggS ? ".ogg" : hasRiff ? ".wav" : hasWebm ? ".webm" : ".mp3";
      return { buf, detectedFmt, detectedMime, detectedExt };
    } catch {}
  }
  return null;
}
cmd(["play!", "musicpick", "songpick"], { desc: "Play song — pick audio format (MIME picker)", category: "DOWNLOAD" }, async (sock, msg, args) => {
  if (!args.length) { await sendReply(sock, msg, `🎵 *Usage:* ${CONFIG.PREFIX}play! <song name or URL>\n\n_Bot searches the song, then lets you pick the audio format before downloading — handy when the default returns a corrupt file._`); return; }
  await react(sock, msg, "🎵");
  const query = args.join(" ");
  const isUrl = /^https?:\/\//i.test(query);
  const jid = msg.key.remoteJid;
  const statusMsg = await sock.sendMessage(jid, { text: `🎵 *MIAS MDX Player (Pick)*\n\n🔍 Searching for *"${query}"*...` }, { quoted: msg });
  const statusKey = statusMsg.key;
  try {
    let videoUrl = isUrl ? query : null;
    let title = query;
    if (!videoUrl) {
      const searchApis = [
        async () => { const { data } = await axios.get(`${CONFIG.GIFTED_API}/api/search/ytsearch?apikey=${CONFIG.GIFTED_KEY}&q=${encodeURIComponent(query)}`, { timeout: 15000 }); const v = data?.result?.[0] || data?.results?.[0]; if (v?.url || v?.link) return { url: v.url || v.link, title: v.title || query }; },
        async () => { const { data } = await axios.get(`https://api.siputzx.my.id/api/y/search?query=${encodeURIComponent(query)}`, { timeout: 15000 }); const v = data?.data?.[0] || data?.result?.[0]; if (v?.url || v?.link) return { url: v.url || v.link, title: v.title || query }; },
        async () => { const r = await ytSearch(query); if (r?.[0]?.url) return { url: r[0].url, title: r[0].title || query }; },
        async () => { const { data } = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }, timeout: 15000 }); const m = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/); if (m) return { url: `https://www.youtube.com/watch?v=${m[1]}`, title: query }; },
      ];
      for (const fn of searchApis) {
        try { const r = await fn(); if (r?.url) { videoUrl = r.url; title = r.title || query; break; } } catch {}
      }
    }
    if (!videoUrl) {
      await editMessage(sock, jid, statusKey, `🎵 *MIAS MDX Player (Pick)*\n\n❌ No results found for: *"${query}"*`);
      return;
    }
    __miasMapSet(_playPickStore, jid, { videoUrl, title, ts: Date.now(), picker: "audio" });
    await sock.sendMessage(jid, { delete: statusKey }).catch(() => {});
    const shortTitle = title.slice(0, 55);
    const pickerText = `🎵 *${shortTitle}*\n\n🎧 Choose the audio format you want to receive:\n_Tip: if one format sounds corrupt, pick another_`;
    const buttons = [
      { text: "🎵 MP3  (standard audio)", id: `${CONFIG.PREFIX}playget mp3` },
      { text: "📦 M4A  (high quality)",   id: `${CONFIG.PREFIX}playget m4a` },
      { text: "🎶 OGG  (opus/ogg)",       id: `${CONFIG.PREFIX}playget ogg` },
      { text: "📄 Send as MP3 Document",  id: `${CONFIG.PREFIX}playget doc` },
    ];
    try { await sendNativeFlowButtons(sock, jid, msg, pickerText, buttons, `${CONFIG.BOT_NAME} • Audio Format Picker`); }
    catch { await sendReply(sock, msg, `${pickerText}\n\nReply with:\n1. MP3\n2. M4A\n3. OGG\n4. MP3 document`); }
  } catch (e) {
    await editMessage(sock, jid, statusKey, `❌ Error: ${e.message}`).catch(() => {});
  }
});

// ── play2! — search then show doc-format picker buttons ──────────────────────
cmd(["play2!", "playdocpick", "songdocpick"], { desc: "Play song as document — pick format (MIME picker)", category: "DOWNLOAD" }, async (sock, msg, args) => {
  if (!args.length) { await sendReply(sock, msg, `🎼 *Usage:* ${CONFIG.PREFIX}play2! <song name or URL>\n\n_Searches the song, lets you pick the document format before downloading._`); return; }
  await react(sock, msg, "🎼");
  const query = args.join(" ");
  const isUrl = /^https?:\/\//i.test(query);
  const jid = msg.key.remoteJid;
  const statusMsg = await sock.sendMessage(jid, { text: `🎼 *MIAS MDX Player Doc (Pick)*\n\n🔍 Searching for *"${query}"*...` }, { quoted: msg });
  const statusKey = statusMsg.key;
  try {
    let videoUrl = isUrl ? query : null;
    let title = query;
    if (!videoUrl) {
      const searchApis = [
        async () => { const { data } = await axios.get(`${CONFIG.GIFTED_API}/api/search/ytsearch?apikey=${CONFIG.GIFTED_KEY}&q=${encodeURIComponent(query)}`, { timeout: 15000 }); const v = data?.result?.[0] || data?.results?.[0]; if (v?.url || v?.link) return { url: v.url || v.link, title: v.title || query }; },
        async () => { const { data } = await axios.get(`https://api.siputzx.my.id/api/y/search?query=${encodeURIComponent(query)}`, { timeout: 15000 }); const v = data?.data?.[0] || data?.result?.[0]; if (v?.url || v?.link) return { url: v.url || v.link, title: v.title || query }; },
        async () => { const r = await ytSearch(query); if (r?.[0]?.url) return { url: r[0].url, title: r[0].title || query }; },
        async () => { const { data } = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }, timeout: 15000 }); const m = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/); if (m) return { url: `https://www.youtube.com/watch?v=${m[1]}`, title: query }; },
      ];
      for (const fn of searchApis) {
        try { const r = await fn(); if (r?.url) { videoUrl = r.url; title = r.title || query; break; } } catch {}
      }
    }
    if (!videoUrl) {
      await editMessage(sock, jid, statusKey, `🎼 *MIAS MDX Player Doc (Pick)*\n\n❌ No results found for: *"${query}"*`);
      return;
    }
    __miasMapSet(_playPickStore, jid, { videoUrl, title, ts: Date.now(), picker: "document" });
    await sock.sendMessage(jid, { delete: statusKey }).catch(() => {});
    const shortTitle = title.slice(0, 55);
    const pickerText = `🎼 *${shortTitle}*\n\n📁 Choose the document format to download:\n_All formats sent as a downloadable file_`;
    const buttons = [
      { text: "📄 MP3 Document  (standard)", id: `${CONFIG.PREFIX}playgetdoc mp3` },
      { text: "📦 M4A Document  (high quality)", id: `${CONFIG.PREFIX}playgetdoc m4a` },
      { text: "🎶 OGG Document  (opus/ogg)", id: `${CONFIG.PREFIX}playgetdoc ogg` },
    ];
    try { await sendNativeFlowButtons(sock, jid, msg, pickerText, buttons, `${CONFIG.BOT_NAME} • Doc Format Picker`); }
    catch { await sendReply(sock, msg, `${pickerText}\n\nReply with:\n1. MP3 document\n2. M4A document\n3. OGG document`); }
  } catch (e) {
    await editMessage(sock, jid, statusKey, `❌ Error: ${e.message}`).catch(() => {});
  }
});

// ── playget — deliver audio in user-chosen format (triggered by play! buttons)
cmd(["playget"], { desc: "Internal: deliver audio after play! format pick", category: "DOWNLOAD" }, async (sock, msg, args) => {
  const jid = msg.key.remoteJid;
  const fmt = (args[0] || "mp3").toLowerCase(); // mp3 | m4a | ogg | doc
  const stored = __miasMapGet(_playPickStore, jid);
  if (!stored || (Date.now() - stored.ts) > 10 * 60 * 1000) {
    await sendReply(sock, msg, `⚠️ No pending song found.\nUse *${CONFIG.PREFIX}play! <song>* first, then pick a format.`); return;
  }
  const { videoUrl, title } = stored;
  try {
    const preferFmt = fmt === "doc" ? "mp3" : fmt;
    const result = await _fetchYtAudioBuf(videoUrl, preferFmt);
    if (!result) {
      await sendReply(sock, msg, `❌ All providers returned no valid audio. Try *${CONFIG.PREFIX}play! ${title.slice(0,40)}* again.`);
      return;
    }
    const { buf, detectedMime, detectedExt } = result;
    const safeName = title.replace(/[^\w\s.-]/g, "_").slice(0, 60);
    if (fmt === "doc") {
      // Force audio/mpeg so the document is a proper playable MP3 file
      await sock.sendMessage(jid, {
        document: buf, mimetype: "audio/mpeg", fileName: `${safeName}.mp3`,
      });
    } else if (fmt === "m4a") {
      // M4A sent as audio/mp4 — user chose it explicitly so WA "unusual format" is expected
      await sock.sendMessage(jid, {
        audio: buf, mimetype: "audio/mp4", ptt: false, fileName: `${safeName}.m4a`
      }).catch(async () => {
        await sock.sendMessage(jid, { document: buf, mimetype: "audio/mp4", fileName: `${safeName}.m4a` });
      });
    } else if (fmt === "ogg") {
      await sock.sendMessage(jid, {
        audio: buf, mimetype: "audio/ogg; codecs=opus", ptt: false, fileName: `${safeName}.ogg`
      }).catch(async () => {
        await sock.sendMessage(jid, { document: buf, mimetype: "audio/ogg", fileName: `${safeName}.ogg` });
      });
    } else {
      // mp3 — only force audio/mpeg if the buffer is actually MP3.
      // If the provider returned m4a/ogg, use the DETECTED mime so WhatsApp
      // doesn't reject the file as "audio file wrong" / corrupt.
      const isRealMp3 = result.detectedFmt === "mp3";
      const useMime = isRealMp3 ? "audio/mpeg" : result.detectedMime;
      const useExt  = isRealMp3 ? ".mp3"        : result.detectedExt;
      try {
        await sock.sendMessage(jid, { audio: buf, mimetype: useMime, ptt: false, fileName: `${safeName}${useExt}` });
      } catch {
        await sock.sendMessage(jid, { document: buf, mimetype: useMime, fileName: `${safeName}${useExt}` });
      }
    }
    __miasMapDelete(_playPickStore, jid);
  } catch (e) {
    await sendReply(sock, msg, `❌ Download error: ${e.message}`).catch(() => {});
  }
});

// ── playgetdoc — deliver as document in chosen format (triggered by play2! buttons)
cmd(["playgetdoc"], { desc: "Internal: deliver audio doc after play2! format pick", category: "DOWNLOAD" }, async (sock, msg, args) => {
  const jid = msg.key.remoteJid;
  const fmt = (args[0] || "mp3").toLowerCase(); // mp3 | m4a | ogg
  const stored = __miasMapGet(_playPickStore, jid);
  if (!stored || (Date.now() - stored.ts) > 10 * 60 * 1000) {
    await sendReply(sock, msg, `⚠️ No pending song found.\nUse *${CONFIG.PREFIX}play2! <song>* first, then pick a format.`); return;
  }
  const { videoUrl, title } = stored;
  try {
    const result = await _fetchYtAudioBuf(videoUrl, fmt);
    if (!result) {
      await sendReply(sock, msg, `❌ All providers returned no valid audio. Try *${CONFIG.PREFIX}play2! ${title.slice(0,40)}* again.`);
      return;
    }
    const { buf } = result;
    const safeName = title.replace(/[^\w\s.-]/g, "_").slice(0, 60);
    // If user picked a format but the buffer is actually a different format,
    // use the DETECTED mime/ext so the document is a valid playable file.
    const reqMime = fmt === "m4a" ? "audio/mp4" : fmt === "ogg" ? "audio/ogg" : "audio/mpeg";
    const reqExt  = fmt === "m4a" ? ".m4a"      : fmt === "ogg" ? ".ogg"      : ".mp3";
    const matches = (fmt === "m4a" && result.detectedFmt === "m4a")
                 || (fmt === "ogg" && result.detectedFmt === "ogg")
                 || (fmt === "mp3" && result.detectedFmt === "mp3");
    const pgdMime = matches ? reqMime : result.detectedMime;
    const pgdExt  = matches ? reqExt  : result.detectedExt;
    await sock.sendMessage(jid, {
      document: buf, mimetype: pgdMime, fileName: `${safeName}${pgdExt}`,
    });
    __miasMapDelete(_playPickStore, jid);
  } catch (e) {
    await sendReply(sock, msg, `❌ Download error: ${e.message}`).catch(() => {});
  }
});

cmd(["playlist", "songs"], { desc: "Show playlist", category: "DOWNLOAD" }, async (sock, msg) => {
  let t = `🎵 *MIAS MDX Playlist (${SONGS.length} songs)*\n\n`;
  SONGS.forEach((s, i) => t += `${i + 1}. *${s.title}* — ${s.artist}${s.file ? " 🎧" : ""}\n`);
  t += `\n🎧 = bundled local track (plays faster!)`;
  await sendReply(sock, msg, t);
});
  return { _playPickStore, _fetchYtAudioBuf };
}

export function installPlayPickers(ctx) {
  const { dcGet, CONFIG, axios, ytSearch, sendReply, __miasMapSet, _playPickStore, fetchPlayThumb, _sendTextMenuPick, __preciousPlayBrand, __miasMapGet } = ctx;
async function __preciousResolvePlayTarget(query) {
  const raw = String(query || "").trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const r = await dcGet("/download/ytmp3", { url: raw }, 30000);
      const d = r?.data?.result || r?.data?.data || r?.data || {};
      return {
        videoUrl: raw,
        title: d?.title || d?.name || raw,
        author: d?.author || d?.artist || d?.channel || "",
        duration: d?.duration || d?.timestamp || "",
        views: d?.views || "",
        published: d?.published || d?.publishedAt || "",
        thumbnail: d?.thumbnail || d?.thumb || d?.image || d?.cover || "",
      };
    } catch {}
    return { videoUrl: raw, title: raw };
  }
  const searchers = [
    async () => {
      const r = await dcGet("/play", { query: raw }, 30000);
      const d = r?.data?.result || r?.data?.data || r?.data || {};
      const videoUrl = d?.video_url || d?.videoUrl || d?.youtube_url || d?.url;
      return videoUrl ? {
        videoUrl,
        title: d?.title || d?.name || raw,
        author: d?.author || d?.artist || d?.channel || "",
        duration: d?.duration || d?.timestamp || "",
        views: d?.views || "",
        published: d?.published || d?.publishedAt || "",
        thumbnail: d?.thumbnail || d?.thumb || d?.image || d?.cover || "",
      } : null;
    },
    async () => {
      if (!CONFIG.GIFTED_API) return null;
      const { data } = await axios.get(
        `${CONFIG.GIFTED_API}/api/search/ytsearch?apikey=${CONFIG.GIFTED_KEY || ""}&q=${encodeURIComponent(raw)}`,
        { timeout: 15000 },
      );
      const item = data?.result?.[0] || data?.results?.[0];
      return item && (item.url || item.link)
        ? { videoUrl: item.url || item.link, title: item.title || raw, thumbnail: item.thumbnail || item.image || "", author: item.author || item.channel || "", duration: item.duration || item.timestamp || "", views: item.views || "", published: item.published || "" }
        : null;
    },
    async () => {
      const { data } = await axios.get(
        `https://api.siputzx.my.id/api/y/search?query=${encodeURIComponent(raw)}`,
        { timeout: 15000 },
      );
      const item = data?.data?.[0] || data?.result?.[0];
      return item && (item.url || item.link)
        ? { videoUrl: item.url || item.link, title: item.title || raw, thumbnail: item.thumbnail || item.image || "", author: item.author || item.channel || "", duration: item.duration || item.timestamp || "", views: item.views || "", published: item.published || "" }
        : null;
    },
    async () => {
      const result = await ytSearch(raw);
      return result?.[0]?.url
        ? { videoUrl: result[0].url, title: result[0].title || raw, thumbnail: result[0].thumbnail || result[0].image || "", author: result[0].author || result[0].channel || "", duration: result[0].duration || result[0].timestamp || "", views: result[0].views || "", published: result[0].published || "" }
        : null;
    },
  ];
  for (const search of searchers) {
    try {
      const result = await search();
      if (result?.videoUrl) return result;
    } catch {}
  }
  return null;
}

function __preciousPlayVideoId(url = "") {
  return String(url).match(/(?:v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1] || "";
}

function __preciousNormalizePlayResult(item, fallback = "") {
  const videoUrl = item?.url || item?.link || item?.video_url || item?.videoUrl
    || item?.youtube_url || item?.youtubeUrl || "";
  if (!/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(String(videoUrl))) return null;
  return {
    videoUrl: String(videoUrl),
    title: String(item?.title || item?.name || item?.videoTitle || fallback || "YouTube video").trim(),
    author: item?.author || item?.channel || item?.uploader || item?.artist || "",
    duration: item?.duration || item?.length || item?.timestamp || item?.lengthText || "",
    views: item?.views || item?.viewCount || "",
    thumbnail: item?.thumbnail || item?.thumbnailUrl || item?.thumb || item?.image
      || (__preciousPlayVideoId(videoUrl) ? `https://img.youtube.com/vi/${__preciousPlayVideoId(videoUrl)}/mqdefault.jpg` : ""),
  };
}

async function __preciousResolvePlayTargets(query) {
  const raw = String(query || "").trim();
  if (/^https?:\/\//i.test(raw)) {
    const one = await __preciousResolvePlayTarget(raw);
    return one?.videoUrl ? [one] : [{ videoUrl: raw, title: raw }];
  }

  const searchers = [
    async () => {
      const result = await ytSearch(raw);
      return (Array.isArray(result) ? result : []).map((item) => __preciousNormalizePlayResult(item, raw)).filter(Boolean);
    },
    async () => {
      const { data } = await axios.get(
        `${CONFIG.GIFTED_API}/api/search/ytsearch?apikey=${CONFIG.GIFTED_KEY || ""}&q=${encodeURIComponent(raw)}`,
        { timeout: 20000 },
      );
      const list = data?.result || data?.results || data?.data || [];
      return (Array.isArray(list) ? list : []).map((item) => __preciousNormalizePlayResult(item, raw)).filter(Boolean);
    },
    async () => {
      const { data } = await axios.get(
        `https://api.siputzx.my.id/api/y/search?query=${encodeURIComponent(raw)}`,
        { timeout: 20000 },
      );
      const list = data?.data || data?.result || data?.results || [];
      return (Array.isArray(list) ? list : []).map((item) => __preciousNormalizePlayResult(item, raw)).filter(Boolean);
    },
  ];
  const merged = [];
  const seen = new Set();
  for (const search of searchers) {
    try {
      const results = await search();
      for (const result of results) {
        const key = __preciousPlayVideoId(result.videoUrl) || result.videoUrl;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(result);
        if (merged.length >= 6) return merged;
      }
    } catch {}
    // The first working search provider normally has the best metadata. Do
    // not wait on every fallback once it has produced a useful result set.
    if (merged.length >= 3) break;
  }
  return merged.slice(0, 6);
}
async function __preciousPlayPicker(sock, msg, args) {
  const query = (args || []).join(" ").trim();
  if (!query) {
    await sendReply(sock, msg, `Usage: ${CONFIG.PREFIX}play <song name or YouTube URL>`);
    return;
  }
  const jid = msg.key.remoteJid;
  const targets = await __preciousResolvePlayTargets(query);
  if (!targets.length) {
    await sendReply(sock, msg, "❌ No YouTube results found. Try a different title.");
    return;
  }
  __miasMapSet(_playPickStore, jid, {
    results: targets,
    ts: Date.now(),
    picker: "search",
  });
  const body = [
    `🎵 *${String(query).slice(0, 70)}*`,
    "",
    ...targets.map((target, index) => {
      const detail = [target.author, target.duration].filter(Boolean).join(" • ");
      return `${index + 1}. *${String(target.title || "YouTube video").slice(0, 90)}*${detail ? `\n   ${detail}` : ""}`;
    }),
    "",
    "Reply with a number to download the audio.",
  ].join("\n");
  const firstThumb = targets.find((target) => target.thumbnail)?.thumbnail;
  const thumb = firstThumb ? await fetchPlayThumb(firstThumb).catch(() => null) : null;
  let prompt = null;
  if (thumb) prompt = await sock.sendMessage(jid, { image: thumb, caption: body }, { quoted: msg });
  else prompt = await _sendTextMenuPick(
    sock,
    jid,
    msg,
    body,
    targets.map((target, index) => ({ text: `${index + 1}. ${target.title}`, id: `${CONFIG.PREFIX}playsearchpick ${index + 1}` })),
    `${__preciousPlayBrand} • Search`,
  );
  const stored = __miasMapGet(_playPickStore, jid);
  if (stored && prompt?.key) stored.promptKey = prompt.key;
}
  return { __preciousResolvePlayTarget, __preciousPlayVideoId, __preciousNormalizePlayResult, __preciousResolvePlayTargets, __preciousPlayPicker };
}

export function installPlaySearchPicker(ctx) {
  const { cmd, __miasMapGet, _playPickStore, __miasMapDelete, sendReply, CONFIG, __deletePickerMessages, react, _fetchYtAudioBuf, __preciousTranscodeAudio } = ctx;
cmd("playsearchpick", {
  desc: "Internal YouTube search result picker",
  category: "DOWNLOAD",
}, async (sock, msg, args) => {
  const jid = msg.key.remoteJid;
  const stored = __miasMapGet(_playPickStore, jid);
  const n = Number(args?.[0] || "");
  if (!stored || stored.picker !== "search" || Date.now() - stored.ts > 10 * 60 * 1000) {
    __miasMapDelete(_playPickStore, jid);
    await sendReply(sock, msg, `⚠️ No pending YouTube search. Use ${CONFIG.PREFIX}play <song name> again.`);
    return;
  }
  const target = Array.isArray(stored.results) ? stored.results[n - 1] : null;
  if (!target?.videoUrl) {
    await sendReply(sock, msg, "❌ That video choice is no longer available.");
    return;
  }
  __miasMapDelete(_playPickStore, jid);
  await __deletePickerMessages(sock, jid, stored);
  await react(sock, msg, "⬇️");
  try {
    const result = await _fetchYtAudioBuf(target.videoUrl, "mp3");
    if (!result?.buf) throw new Error("audio provider returned no file");
    let audio = result.buf;
    let mimetype = result.detectedMime || "audio/mpeg";
    let extension = result.detectedExt || ".mp3";
    if (result.detectedFmt !== "mp3") {
      audio = await __preciousTranscodeAudio(result.buf, String(extension).replace(/^\./, "") || "bin");
      mimetype = "audio/mpeg";
      extension = ".mp3";
    }
    const safeName = String(target.title || "audio")
      .replace(/[^\w\s.-]/g, "_")
      .trim()
      .slice(0, 70) || "audio";
    try {
      await sock.sendMessage(jid, {
        audio,
        mimetype,
        ptt: false,
        fileName: `${safeName}${extension}`,
      });
    } catch {
      await sock.sendMessage(jid, {
        document: audio,
        mimetype,
        fileName: `${safeName}${extension}`,
      });
    }
    await react(sock, msg, "✅");
  } catch (error) {
    await react(sock, msg, "❌");
    await sendReply(sock, msg, `❌ Could not download the selected video: ${error?.message || "download failed"}`);
  }
});
  return {  };
}

export function installPlayOutputPicker(ctx) {
  const { cmd, __miasMapGet, _playPickStore, __miasMapDelete, sendReply, CONFIG, _fetchYtAudioBuf, __preciousVoiceBuffer, __preciousTranscodeAudio } = ctx;
cmd("playgetmode", {
  desc: "Internal play output picker",
  category: "DOWNLOAD",
}, async (sock, msg, args) => {
  const jid = msg.key.remoteJid;
  const choice = String(args?.[0] || "").toLowerCase();
  const mode = choice === "document" || choice === "doc"
    ? "document"
    : choice === "voice" || choice === "vn"
      ? "voice"
      : "audio";
  const stored = __miasMapGet(_playPickStore, jid);
  if (!stored || stored.picker !== "output" || Date.now() - stored.ts > 10 * 60 * 1000) {
    __miasMapDelete(_playPickStore, jid);
    await sendReply(sock, msg, `⚠️ No pending song. Use ${CONFIG.PREFIX}play <song name> first.`);
    return;
  }
  __miasMapDelete(_playPickStore, jid);
  try {
    const requestedFormat = mode === "voice" ? "ogg" : "mp3";
    const result = await _fetchYtAudioBuf(stored.videoUrl, requestedFormat);
    if (!result?.buf) throw new Error("audio provider returned no file");
    let payloadBuffer = result.buf;
    let mimetype = result.detectedMime || "audio/mpeg";
    let extension = result.detectedExt || ".mp3";
    if (mode === "voice") {
      if (result.detectedFmt !== "ogg") {
        payloadBuffer = await __preciousVoiceBuffer(result.buf, String(extension).replace(/^\./, "") || "mp3");
      }
      mimetype = "audio/ogg; codecs=opus";
      extension = ".ogg";
    } else if (result.detectedFmt !== "mp3") {
      // WhatsApp is strict about inline audio.  Providers often return WebM,
      // M4A, or WAV bytes while labelling the URL as MP3; transcode those
      // bytes instead of sending a mismatched MIME type.
      payloadBuffer = await __preciousTranscodeAudio(result.buf, extension);
      mimetype = "audio/mpeg";
      extension = ".mp3";
    }
    const safeName = String(stored.title || "audio")
      .replace(/[^\w\s.-]/g, "_")
      .trim()
      .slice(0, 60) || "audio";
    const content = mode === "voice"
      ? { audio: payloadBuffer, mimetype, ptt: true }
      : mode === "document"
        ? { document: payloadBuffer, mimetype, fileName: `${safeName}${extension}` }
        : { audio: payloadBuffer, mimetype, ptt: false, fileName: `${safeName}${extension}` };
    // Deliberately no quoted message, caption, status text, or success text.
    await sock.sendMessage(jid, content);
  } catch (error) {
    await sendReply(sock, msg, `❌ Could not send the selected song: ${error?.message || "download failed"}`);
  }
});
  return {  };
}

export function installPlayWrappers(ctx) {
  const { commands, __preciousPlayPicker, _p2ResolveCardRegistrar, sendReply, CONFIG } = ctx;
for (const name of ["play", "music", "song"]) {
  const entry = commands.get(name) || { category: "DOWNLOAD" };
  entry.handler = __preciousPlayPicker;
  entry._origHandler = __preciousPlayPicker;
  entry.__preciousPlayPicker = true;
  commands.set(name, entry);
}
try {
  const _card = commands.get("play") && commands.get("play").__playCardHandler;
  const _cardHandler = (typeof globalThis.__RDL_PLAY_HANDLER__ === "function") ? globalThis.__RDL_PLAY_HANDLER__ : ((typeof _p2ResolveCardRegistrar === "function") ? _p2ResolveCardRegistrar() : null);
  if (_cardHandler) {
    for (const name of ["play", "music", "song"]) {
      const entry = commands.get(name) || { category: "DOWNLOAD" };
      entry.handler = _cardHandler;
      entry._origHandler = _cardHandler;
      entry.__playCardHandler = _cardHandler;
      commands.set(name, entry);
    }
    console.log("[precious-fix-pack] play card handler registered (quote 1-4 enabled)");
  } else {
    console.log("[precious-fix-pack] play card registrar unavailable — keeping search picker");
  }
} catch (e) {
  console.log("[precious-fix-pack] play re-register failed:", e && e.message);
}
try {
  if (!commands.has("playsearch")) {
    const entry = { category: "DOWNLOAD", desc: "Search YouTube and pick a result" };
    entry.handler = async (sock, msg, args) => {
      const p = commands.get("play");
      const fn = (p && p.__preciousPlayPicker) ? p.__preciousPlayPicker : null;
      if (typeof fn === "function") return fn(sock, msg, args);
      return sendReply(sock, msg, "Usage: " + CONFIG.PREFIX + "play <song name or YouTube URL>");
    };
    commands.set("playsearch", entry);
  }
} catch {}
  return {  };
}
