import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  extractQuotedContext,
  parsePinDuration,
  getPinDurationLabel,
  buildPinKey
} = require("../lib/pin-helper.cjs");

test("pin-helper: parses durations and labels accurately", () => {
  assert.equal(parsePinDuration("24h"), 86400);
  assert.equal(parsePinDuration("1d"), 86400);
  assert.equal(parsePinDuration("7d"), 604800);
  assert.equal(parsePinDuration("30d"), 2592000);
  assert.equal(parsePinDuration(undefined), 604800);

  assert.equal(getPinDurationLabel(86400), "24 hours");
  assert.equal(getPinDurationLabel(604800), "7 days");
  assert.equal(getPinDurationLabel(2592000), "30 days");
});

test("pin payload: conforms exactly to Baileys sendMessage pin spec", async () => {
  const fakeSock = {
    user: { id: "2348123456789:1@s.whatsapp.net" },
    sent: [],
    sendMessage: async (jid, content) => {
      fakeSock.sent.push({ jid, content });
      return { key: { id: "msg-id-123", remoteJid: jid } };
    }
  };

  const groupJid = "120363000000000000@g.us";
  const authorJid = "2348999999999@s.whatsapp.net";
  const quotedCtx = {
    stanzaId: "STANZA-XYZ",
    participant: authorJid,
    fromMe: false
  };

  const pinKey = buildPinKey(fakeSock, groupJid, quotedCtx);
  assert.deepEqual(pinKey, {
    remoteJid: groupJid,
    fromMe: false,
    id: "STANZA-XYZ",
    participant: authorJid
  });

  // Pin message for 24 hours
  await fakeSock.sendMessage(groupJid, { pin: pinKey, type: 1, time: 86400 });
  assert.equal(fakeSock.sent.length, 1);
  assert.equal(fakeSock.sent[0].content.type, 1);
  assert.equal(fakeSock.sent[0].content.time, 86400);
  assert.deepEqual(fakeSock.sent[0].content.pin, pinKey);

  // Unpin message
  await fakeSock.sendMessage(groupJid, { pin: pinKey, type: 2 });
  assert.equal(fakeSock.sent.length, 2);
  assert.equal(fakeSock.sent[1].content.type, 2);
  assert.deepEqual(fakeSock.sent[1].content.pin, pinKey);
});

test("pin payload: DM pinner cleanly omits participant", async () => {
  const fakeSock = {
    user: { id: "2348123456789:1@s.whatsapp.net" }
  };
  const dmJid = "2348999999999@s.whatsapp.net";
  const quotedCtx = {
    stanzaId: "DM-STANZA-999",
    participant: dmJid,
    fromMe: false
  };

  const pinKey = buildPinKey(fakeSock, dmJid, quotedCtx);
  assert.deepEqual(pinKey, {
    remoteJid: dmJid,
    fromMe: false,
    id: "DM-STANZA-999"
  });
  assert.equal("participant" in pinKey, false);
});
