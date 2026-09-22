/**
 * Forward messages that receive a reaction to the bot's private chat.
 *
 * This is deliberately an event-level feature instead of command logic. It
 * keeps working for text, documents, stickers, and every future media type
 * Baileys can decode. The original message is cached briefly because reaction
 * events contain only the target key, not the full message.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 2000;

function keyOf(key = {}) {
  return [key.remoteJid || "", key.id || "", key.participant || ""].join("|");
}

function unwrap(message) {
  let current = message;
  for (let i = 0; i < 8 && current; i++) {
    const next = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.documentWithCaptionMessage?.message;
    if (!next) break;
    current = next;
  }
  return current || {};
}

function isForwardable(message) {
  const content = unwrap(message?.message || message);
  if (!content || content.protocolMessage || content.reactionMessage) return false;
  return Boolean(
    content.conversation
    || content.extendedTextMessage
    || content.imageMessage
    || content.videoMessage
    || content.audioMessage
    || content.documentMessage
    || content.stickerMessage
    || content.locationMessage
    || content.contactMessage
  );
}

export function installReactionForwarder(sock, options = {}) {
  if (!sock?.ev || sock.__miasReactionForwarder) return;
  sock.__miasReactionForwarder = true;

  const cache = new Map();
  const ownerJid = String(options.ownerJid || sock.user?.id || "")
    .replace(/:\d+(?=@)/, "");

  const remember = (message) => {
    if (!message?.key?.id || !isForwardable(message)) return;
    cache.set(keyOf(message.key), { message, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > MAX_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  };

  sock.ev.on("messages.upsert", (event = {}) => {
    for (const message of event.messages || []) remember(message);
  });

  sock.ev.on("messages.reaction", async (events = []) => {
    for (const event of Array.isArray(events) ? events : [events]) {
      try {
        const reaction = event?.reaction || event;
        if (!reaction?.key || reaction.key.fromMe) continue;
        const sourceJid = reaction.key.remoteJid || "";
        if (!sourceJid.endsWith("@g.us")) continue;
        if (!ownerJid || ownerJid === sourceJid) continue;

        const cached = cache.get(keyOf(reaction.key));
        if (!cached || cached.expiresAt < Date.now()) {
          cache.delete(keyOf(reaction.key));
          continue;
        }
        const original = cached.message;
        const actor = reaction.senderPn || reaction.key.participant || "a member";
        const note = `Reaction received from ${String(actor).split("@")[0]} in ${sourceJid}`;
        await sock.sendMessage(ownerJid, { text: note });
        if (typeof sock.copyNForward === "function") {
          await sock.copyNForward(ownerJid, original, true);
        } else {
          await sock.sendMessage(ownerJid, { forward: original });
        }
      } catch (error) {
        console.error("[reaction-forward]", error?.message || error);
      }
    }
  });
}