'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   PRECIOUS v29 — FIX PACK (dead-last installer)
   Fixes, all self-healing on every deploy:
   1) TT picker silent on "1.1" (typed or quoted)  → widened pending-check +
      PATCH-v29.cjs makes the settings dispatcher hand unknown N.N shapes to
      the picker FIRST instead of swallowing them silently.
   2) movie/nkiri/savetube quote fixes "not applied" → v28 existed but its
      install() ran at require-time when the live commands map was not yet
      exposed, failed once with "commands map not found" and never retried.
      v29 chains v28.install and the boot loader retries it deferred until
      the commands map is visible.
   3) native button flow dead on WhatsApp Android 11 → smart sender helper +
      PATCH-v29.cjs adds a direct/viewOnce strategy chain to both native
      senders (env BUTTON_MODE=direct|viewonce|auto to force one).
   4) chatbot enable does nothing → __v29ApplyChatbot arms owner AND current
      chat; PATCH-v29.cjs also makes the auto-chat loop honor owner-level
      chatBotMode and log provider failures instead of dying silently.
   ══════════════════════════════════════════════════════════════════════════ */

const log  = (m) => { try { console.log('[v29] ' + m); } catch (_) {} };
const ok   = (m) => { try { console.log('[v29] ✅ ' + m); } catch (_) {} };
const bad  = (m) => { try { console.log('[v29] ❌ ' + m); } catch (_) {} };

/* Extract text from a quoted (replied-to) message, unwrapping wrappers. */
function __v29QuotedText(msg) {
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
    return String(
      q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption
      || q.videoMessage?.caption || q.documentMessage?.caption
      || q.buttonsMessage?.contentText || q.listMessage?.description
      || q.templateMessage?.hydratedTemplate?.hydratedContentText
      || q.interactiveMessage?.body?.text || ''
    ).trim();
  } catch { return ''; }
}

function findCommands() {
  const cands = [
    globalThis.__PRECIOUS__ && globalThis.__PRECIOUS__.commands,
    globalThis.__MIAS_COMMANDS,
    globalThis.__commands,
  ];
  for (const c of cands) if (c && typeof c.get === 'function' && typeof c.set === 'function') return c;
  try {
    for (const k of Object.keys(globalThis)) {
      const v = globalThis[k];
      if (v instanceof Map && v.get('movie') && v.get('movie').handler) return v;
    }
  } catch (_) {}
  return null;
}

function install(ctx) {
  ctx = ctx || {};
  const commands = findCommands();
  const report = { commandsFound: !!commands, movieQuote: false, nkiri: false, savetube: false, picker: false, nativeSender: false, chatbot: false };

  /* ── 2) chain v28 (movie quote + real .nkiri) once the map is visible ── */
  if (commands) {
    try {
      const v28 = require('./precious-fixes-v28.cjs');
      if (v28 && typeof v28.install === 'function') {
        const r = v28.install(Object.assign({}, ctx, { commands })) || {};
        report.movieQuote = !!r.movieQuote; report.nkiri = !!r.nkiri;
      }
    } catch (e) { bad('v28 chain failed: ' + (e && e.message)); }
    /* savetube & friends: accept the quoted message as the query too */
    try {
      for (const name of ['savetube', 'save', 'ytmp4', 'ytmate', 'moviedl']) {
        const ex = commands.get(name);
        if (ex && ex.handler && !ex.__v29Quote) {
          const orig = ex.handler;
          ex.handler = async (sock, msg, args) => {
            if (!args || !args.length) {
              const qt = __v29QuotedText(msg);
              if (qt) args = qt.split(/\s+/);
            }
            return orig(sock, msg, args || []);
          };
          ex.__v29Quote = true;
          commands.set(name, ex);
          report.savetube = true;
        }
      }
      if (report.savetube) ok('savetube quote-reply wrapper armed');
    } catch (e) { bad('savetube wrap failed: ' + (e && e.message)); }
  } else {
    log('commands map not exposed yet — boot loader will retry deferred');
  }

  /* ── 1) widen the pending-picker check (survives restart/eviction) ── */
  if (!globalThis.__v29PickerWidened) {
    const prev = globalThis.__miasHasPendingPicker;
    globalThis.__miasHasPendingPicker = function (jid) {
      try { if (typeof prev === 'function' && prev(jid)) return true; } catch (_) {}
      try { if (typeof globalThis.__ttGetSelection === 'function' && globalThis.__ttGetSelection(jid)) return true; } catch (_) {}
      return false;
    };
    globalThis.__v29PickerWidened = true;
    report.picker = true;
    ok('picker pending-check widened');
  }

  /* ── 3) smart native-button sender: direct → viewOnce → plain text ── */
  if (!globalThis.__miasSendNativeSmart) {
    globalThis.__miasSendNativeSmart = async function (sock, jid, quoted, interactiveContent, plainFallback) {
      const gen = globalThis.generateWAMessageFromContent;
      const mode = String(process.env.BUTTON_MODE || 'auto').toLowerCase();
      const seq = mode === 'direct' ? ['direct'] : mode === 'viewonce' ? ['viewonce'] : ['direct', 'viewonce'];
      for (const m of seq) {
        try {
          const payload = m === 'viewonce' ? { viewOnceMessage: { message: interactiveContent } } : interactiveContent;
          if (gen) {
            const wam = await gen(jid, payload, { quoted, userJid: sock.user && sock.user.id });
            await sock.relayMessage(jid, wam.message, { messageId: wam.key.id });
          } else {
            await sock.sendMessage(jid, payload, { quoted });
          }
          return true;
        } catch (_) {}
      }
      if (plainFallback) { try { await sock.sendMessage(jid, { text: String(plainFallback) }, { quoted }); } catch (_) {} }
      return null;
    };
    report.nativeSender = true;
    ok('smart native-button sender installed (BUTTON_MODE=auto)');
  }

  /* ── 4) chatbot: arm owner AND the current chat in one call ── */
  if (!globalThis.__v29ApplyChatbot) {
    globalThis.__v29ApplyChatbot = function (getSettings, ownerJid, chatJid, on) {
      try { const o = getSettings(ownerJid); if (o) { o.chatBotMode = on; o.autoReply = on; } } catch (_) {}
      try { const c = getSettings(chatJid);  if (c) { c.autoReply = on; c.chatBotMode = on; } } catch (_) {}
      return true;
    };
    report.chatbot = true;
    ok('chatbot enable helper installed');
  }

  ok('install pass complete: ' + JSON.stringify(report));
  return report;
}

module.exports = { install };
