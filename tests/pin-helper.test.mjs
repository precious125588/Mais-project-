import test from "node:test";
import assert from "node:assert/strict";

import {
  extractQuotedContext,
  parsePinDuration,
  getPinDurationLabel,
  normalizeJid,
  buildPinKey,
  unwrapMessage
} from "../lib/pin-helper.mjs";

test("extractQuotedContext extracts context from basic extendedTextMessage", () => {
  const msg = {
    message: {
      extendedTextMessage: {
        text: ".pin",
        contextInfo: {
          stanzaId: "MSG-001",
          participant: "1234567890:12@s.whatsapp.net",
          quotedMessage: { conversation: "Hello world" }
        }
      }
    }
  };

  const ctx = extractQuotedContext(msg);
  assert.ok(ctx);
  assert.equal(ctx.stanzaId, "MSG-001");
  assert.equal(ctx.participant, "1234567890:12@s.whatsapp.net");
  assert.equal(ctx.fromMe, false);
  assert.deepEqual(ctx.quotedMessage, { conversation: "Hello world" });
});

test("extractQuotedContext unwraps nested ephemeral and viewOnce messages", () => {
  const msg = {
    message: {
      ephemeralMessage: {
        message: {
          viewOnceMessageV2: {
            message: {
              imageMessage: {
                caption: ".pin 24h",
                contextInfo: {
                  stanzaId: "MSG-EPHEM-002",
                  participant: "9876543210@s.whatsapp.net",
                  fromMe: false
                }
              }
            }
          }
        }
      }
    }
  };

  const ctx = extractQuotedContext(msg);
  assert.ok(ctx);
  assert.equal(ctx.stanzaId, "MSG-EPHEM-002");
  assert.equal(ctx.participant, "9876543210@s.whatsapp.net");
});

test("extractQuotedContext returns null when no quoted message is present", () => {
  const msg = {
    message: {
      conversation: ".pin"
    }
  };

  const ctx = extractQuotedContext(msg);
  assert.equal(ctx, null);
});

test("parsePinDuration maps tokens accurately to WhatsApp duration seconds", () => {
  assert.equal(parsePinDuration("24h"), 86400);
  assert.equal(parsePinDuration("1d"), 86400);
  assert.equal(parsePinDuration("24hr"), 86400);

  assert.equal(parsePinDuration("7d"), 604800);
  assert.equal(parsePinDuration("1w"), 604800);
  assert.equal(parsePinDuration(""), 604800);
  assert.equal(parsePinDuration(null), 604800);
  assert.equal(parsePinDuration(undefined), 604800);

  assert.equal(parsePinDuration("30d"), 2592000);
  assert.equal(parsePinDuration("1m"), 2592000);
  assert.equal(parsePinDuration("1month"), 2592000);

  assert.equal(getPinDurationLabel(86400), "24 hours");
  assert.equal(getPinDurationLabel(604800), "7 days");
  assert.equal(getPinDurationLabel(2592000), "30 days");
});

test("normalizeJid strips device suffixes and preserves domain", () => {
  assert.equal(normalizeJid("1234567890:12@s.whatsapp.net"), "1234567890@s.whatsapp.net");
  assert.equal(normalizeJid("1234567890@s.whatsapp.net"), "1234567890@s.whatsapp.net");
  assert.equal(normalizeJid("99998888:0@lid"), "99998888@lid");
  assert.equal(normalizeJid("12345-6789@g.us"), "12345-6789@g.us");
});

test("buildPinKey builds correct group key for messages sent by another participant", () => {
  const sock = {
    user: { id: "2348000000000:1@s.whatsapp.net", lid: "111222333@lid" }
  };
  const jid = "120363028123456789@g.us";
  const ctx = {
    stanzaId: "MSG-100",
    participant: "2348111111111:5@s.whatsapp.net",
    fromMe: false
  };

  const key = buildPinKey(sock, jid, ctx);
  assert.deepEqual(key, {
    remoteJid: jid,
    id: "MSG-100",
    fromMe: false,
    participant: "2348111111111@s.whatsapp.net"
  });
});

test("buildPinKey detects fromMe when participant matches bot phone number or LID", () => {
  const sock = {
    user: { id: "2348000000000:1@s.whatsapp.net", lid: "111222333@lid" }
  };
  const jid = "120363028123456789@g.us";

  // Quoted message sent by bot via phone JID
  const ctxPhone = {
    stanzaId: "MSG-BOT-1",
    participant: "2348000000000:8@s.whatsapp.net",
    fromMe: false // e.g. incorrectly set or missing in envelope
  };
  const keyPhone = buildPinKey(sock, jid, ctxPhone);
  assert.equal(keyPhone.fromMe, true);
  assert.equal(keyPhone.id, "MSG-BOT-1");

  // Quoted message sent by bot via LID
  const ctxLid = {
    stanzaId: "MSG-BOT-2",
    participant: "111222333:2@lid",
    fromMe: false
  };
  const keyLid = buildPinKey(sock, jid, ctxLid);
  assert.equal(keyLid.fromMe, true);
  assert.equal(keyLid.id, "MSG-BOT-2");
});

test("buildPinKey in 1-on-1 DM omits participant", () => {
  const sock = {
    user: { id: "2348000000000:1@s.whatsapp.net" }
  };
  const jid = "2348999999999@s.whatsapp.net";
  const ctx = {
    stanzaId: "MSG-DM-1",
    participant: "2348999999999@s.whatsapp.net",
    fromMe: false
  };

  const key = buildPinKey(sock, jid, ctx);
  assert.deepEqual(key, {
    remoteJid: jid,
    id: "MSG-DM-1",
    fromMe: false
  });
  assert.equal("participant" in key, false);
});
