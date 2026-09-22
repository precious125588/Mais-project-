/**
 * MIAS — Forward Handler
 *
 * Centralizes all message forwarding logic.
 * Commands must never build forwarding logic manually.
 *
 * Architecture:  Commands → Handlers → Baileys Adapter → WhatsApp
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

function _injectForwardScore(content, score) {
  const cloned = _deepClone(content);
  const firstKey = Object.keys(cloned || {})[0];
  if (!firstKey) return cloned;
  cloned[firstKey] = cloned[firstKey] || {};
  cloned[firstKey].contextInfo = {
    ...(cloned[firstKey].contextInfo || {}),
    forwardingScore: score,
    isForwarded: score > 0,
  };
  return cloned;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Forward a message to a JID.
 *
 * @param {object} sock
 * @param {string} toJid          - Destination JID
 * @param {object} msg            - WAMessage object
 * @param {object} [opts]
 * @param {number} [opts.score=1] - forwardingScore (1 = "Forwarded", 0 = none)
 * @param {boolean}[opts.force]   - Forward even if message has no content
 * @returns {Promise<object|null>}
 */
export async function forwardMessage(sock, toJid, msg, opts = {}) {
  try {
    const content = msg?.message;
    if (!content && !opts.force) return null;

    const score = opts.score ?? 1;
    const patched = _injectForwardScore(content, score);
    return await sock.sendMessage(toJid, patched);
  } catch (err) {
    console.error("[forwardMessage] Error:", err?.message);
    return null;
  }
}

/**
 * Forward a message without the "Forwarded" label.
 *
 * @param {object} sock
 * @param {string} toJid
 * @param {object} msg
 * @returns {Promise<object|null>}
 */
export async function forwardSilent(sock, toJid, msg) {
  return forwardMessage(sock, toJid, msg, { score: 0 });
}

/**
 * Forward a message to multiple JIDs.
 *
 * @param {object}   sock
 * @param {string[]} jids
 * @param {object}   msg
 * @param {object}   [opts]
 * @returns {Promise<(object|null)[]>}
 */
export async function broadcastForward(sock, jids, msg, opts = {}) {
  const results = [];
  for (const jid of jids) {
    try {
      results.push(await forwardMessage(sock, jid, msg, opts));
    } catch {
      results.push(null);
    }
  }
  return results;
}

/**
 * Re-send a message's raw content (no forward label, clean copy).
 *
 * @param {object} sock
 * @param {string} toJid
 * @param {object} msg       - WAMessage object
 * @param {object} [extra]   - Extra sendMessage options
 * @returns {Promise<object|null>}
 */
export async function resendMessage(sock, toJid, msg, extra = {}) {
  try {
    const content = msg?.message;
    if (!content) return null;
    return await sock.sendMessage(toJid, content, extra);
  } catch (err) {
    console.error("[resendMessage] Error:", err?.message);
    return null;
  }
}
