'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   PRECIOUS v28 — reply-quote logic for .movie / .nkiri + real .nkiri command
   ─────────────────────────────────────────────────────────────────────────
   1) .movie reply-quote: reply to ANY message that contains a title and run
      ".movie" with no args — the quoted text becomes the search query.
   2) .nkiri: there was no real "nkiri" command registered (only .dcnkiri),
      so the old v26 quote-wrapper had nothing to wrap and .nkiri was dead.
      v28 registers a real .nkiri command that reuses the dcnkiri search
      handler and ALSO accepts the quoted message as the query.
   3) Installs DEAD LAST (hooked in precious-all-packs-boot.cjs) so nothing
      can register over these handlers afterwards.
   ══════════════════════════════════════════════════════════════════════════ */

// ── extract text from a quoted (replied-to) message, unwrapping wrappers ──
function __v28QuotedText(msg) {
  try {
    const unwrap = (m) => {
      let cur = m;
      for (let i = 0; i < 6 && cur && typeof cur === 'object'; i++) {
        const nxt = cur.ephemeralMessage?.message
          || cur.viewOnceMessage?.message
          || cur.viewOnceMessageV2?.message
          || cur.viewOnceMessageV2Extension?.message
          || cur.documentWithCaptionMessage?.message
          || cur.editedMessage?.message;
        if (!nxt) break;
        cur = nxt;
      }
      return cur || {};
    };
    const ctx = msg.message?.extendedTextMessage?.contextInfo
      || msg.message?.imageMessage?.contextInfo
      || msg.message?.videoMessage?.contextInfo
      || msg.message?.documentMessage?.contextInfo
      || msg.message?.audioMessage?.contextInfo
      || msg.message?.stickerMessage?.contextInfo;
    if (!ctx?.quotedMessage) return '';
    const q = unwrap(ctx.quotedMessage);
    const text = q.conversation
      || q.extendedTextMessage?.text
      || q.imageMessage?.caption
      || q.videoMessage?.caption
      || q.documentMessage?.caption
      || q.buttonsMessage?.contentText
      || q.listMessage?.description
      || q.templateMessage?.hydratedTemplate?.hydratedContentText
      || q.interactiveMessage?.body?.text
      || '';
    return String(text || '').trim();
  } catch { return ''; }
}

function __v28FindCommands(ctx) {
  const cands = [
    ctx && ctx.commands,
    globalThis.__PRECIOUS__ && globalThis.__PRECIOUS__.commands,
    globalThis.__MIAS_COMMANDS,
    globalThis.__commands,
  ];
  for (const c of cands) {
    if (c && typeof c.get === 'function' && typeof c.set === 'function') return c;
  }
  // Last resort: find the live commands Map on globalThis.
  try {
    for (const k of Object.keys(globalThis)) {
      const v = globalThis[k];
      if (v instanceof Map && v.get('movie') && v.get('movie').handler) return v;
    }
  } catch {}
  return null;
}

function install(ctx) {
  const commands = __v28FindCommands(ctx || {});
  if (!commands) { console.log('[precious-v28] ❌ commands map not found'); return { ok: false }; }

  const sendReply = (ctx && ctx.sendReply)
    || globalThis.__miasSendReply
    || (async (sock, msg, text) => { await sock.sendMessage(msg.key.remoteJid, { text: String(text) }, { quoted: msg }); });
  const react = (ctx && ctx.react)
    || globalThis.__miasReact
    || (async () => {});

  const report = { movieQuote: false, nkiri: false };

  // ── 1) .movie — reply-quote logic (wrap the existing handler) ───────────
  const mv = commands.get('movie');
  if (mv && mv.handler && !mv.__v28Quote) {
    const orig = mv.handler;
    mv.handler = async (sock, msg, args) => {
      if (!args || !args.length) {
        const qt = __v28QuotedText(msg);
        if (qt) args = qt.split(/\s+/);
      }
      return orig(sock, msg, args || []);
    };
    mv.__v28Quote = true;
    commands.set('movie', mv);
    report.movieQuote = true;
  }

  // ── 2) .nkiri — real command (reuses dcnkiri handler) + quote logic ─────
  const src = commands.get('dcnkiri') || commands.get('nkiridc') || commands.get('nkirisearch');
  if (src && src.handler) {
    const origNk = src.handler;
    const nkHandler = async (sock, msg, args) => {
      if (!args || !args.length) {
        const qt = __v28QuotedText(msg);
        if (qt) args = qt.split(/\s+/);
      }
      if (!args || !args.length) {
        await sendReply(sock, msg, 'Usage: .nkiri <movie title> — or reply to a message containing the title with .nkiri');
        return;
      }
      return origNk(sock, msg, args);
    };
    const existing = commands.get('nkiri');
    if (existing) {
      existing.handler = nkHandler;
      existing.desc = existing.desc || 'Search Nkiri movies — .nkiri <title> (or reply to a title)';
      commands.set('nkiri', existing);
    } else {
      commands.set('nkiri', {
        desc: 'Search Nkiri movies — .nkiri <title> (or reply to a title)',
        category: 'INFO',
        handler: nkHandler,
      });
    }
    report.nkiri = true;
  }

  console.log('[precious-v28] ✅ installed —', JSON.stringify(report));
  return { ok: true, ...report };
}

module.exports = { install };
