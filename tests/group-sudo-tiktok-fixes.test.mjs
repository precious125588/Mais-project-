import test from "node:test";
import assert from "node:assert/strict";
import { installSudoCommand, sudoPending } from "../mias/features/sudoCommands.js";

test("Sudo command in user DM without args targets the DM participant", async () => {
  let replyText = "";
  let sentImage = null;
  let sentMentions = [];

  const mockSock = {
    user: { id: "2348011111111:1@s.whatsapp.net" },
    profilePictureUrl: async () => null,
    sendMessage: async (jid, content) => {
      replyText = content.caption || content.text;
      sentImage = content.image;
      sentMentions = content.mentions;
      return { key: { id: "msg1" } };
    }
  };

  const registeredCmds = new Map();
  const ctx = {
    cmd: (name, opts, handler) => {
      const names = [].concat(name);
      for (const n of names) registeredCmds.set(n, handler);
    },
    react: async () => {},
    isGroup: (msg) => (msg.key.remoteJid || "").endsWith("@g.us"),
    sendReply: async (sock, msg, text, mentions) => {
      replyText = text;
      sentMentions = mentions || [];
    },
    _cleanNum: (j) => String(j || "").replace(/[^0-9]/g, ""),
    getBotPic: async () => Buffer.from("fake-pic"),
    getSender: (msg) => msg.key.participant || msg.key.remoteJid,
  };

  installSudoCommand(ctx);
  const sudoHandler = registeredCmds.get("sudo");
  assert.ok(sudoHandler, "sudo handler registered");

  // Case 1: Owner running .sudo in user DM (2348099999999@s.whatsapp.net) with no args
  const userDmMsg = {
    key: {
      remoteJid: "2348099999999@s.whatsapp.net",
      fromMe: true, // owner running command
    },
    message: {
      conversation: ".sudo"
    }
  };

  await sudoHandler(mockSock, userDmMsg, []);
  assert.ok(replyText.includes("SUDO — ACCESS CONTROL"), "Should issue sudo card");
  assert.ok(replyText.includes("Target: @2348099999999"), "Target should be the user in DM");
  assert.deepEqual(sentMentions, ["2348099999999@s.whatsapp.net"]);

  // Case 2: Running .sudo in bot's own DM or targeting bot itself should reject
  const botDmMsg = {
    key: {
      remoteJid: "2348011111111@s.whatsapp.net",
      fromMe: true
    },
    message: { conversation: ".sudo" }
  };
  replyText = "";
  await sudoHandler(mockSock, botDmMsg, []);
  assert.ok(replyText.includes("Unauthorized behavior"), "Should reject targeting bot");

  // Case 3: Self-targeting should reject
  const selfTargetMsg = {
    key: {
      remoteJid: "2348099999999@s.whatsapp.net",
      fromMe: false,
      participant: "2348099999999@s.whatsapp.net"
    },
    message: { conversation: ".sudo 2348099999999" }
  };
  replyText = "";
  await sudoHandler(mockSock, selfTargetMsg, ["2348099999999"]);
  assert.ok(replyText.includes("Unauthorized behavior"), "Should reject self targeting");
});

test("TikTok 4.1 parse mode normalization works", async () => {
  const { parseTikTokMode, normalizeTikTokMode } = await import("../mias/features/tiktok.js");
  const mode = parseTikTokMode("4.1");
  assert.equal(mode?.kind, "slider");
  assert.equal(mode?.id, "4.1");
});
