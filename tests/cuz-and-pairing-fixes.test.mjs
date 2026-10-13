import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Bare .cuz without value is rejected with empty value field error", async () => {
  const cuz = await import("../mias/features/cuzCustomization.cjs");
  let sentMessages = [];
  let registeredHandler = null;

  const fakeSock = {
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: "test-menu-msg" } };
    }
  };

  const fakeCmd = (names, opts, fn) => {
    registeredHandler = fn;
  };

  cuz.installCuzSystem({
    cmd: fakeCmd,
    CONFIG: { BOT_NAME: "MIA'S MDX", PREFIX: "." },
    getSettings: () => ({}),
    saveNow: () => {}
  });

  assert.ok(typeof registeredHandler === "function", "cuz handler should be registered");

  // Call .cuz with NO args (bare command)
  await registeredHandler(fakeSock, { key: { remoteJid: "12345@s.whatsapp.net" } }, []);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].content.text, /Invalid command: empty value field/i);
  assert.match(sentMessages[0].content.text, /\.cuz <value>/i);
});

test("Valid .cuz <value> creates session and applies value to selected option", async () => {
  const cuz = await import("../mias/features/cuzCustomization.cjs");
  let sentMessages = [];
  let registeredHandler = null;

  let store = {};
  const fakeSock = {
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: "test-menu-msg-2" } };
    }
  };

  const fakeCmd = (names, opts, fn) => {
    registeredHandler = fn;
  };

  const CONFIG = { BOT_NAME: "Original Name", PREFIX: "." };

  cuz.installCuzSystem({
    cmd: fakeCmd,
    CONFIG,
    getSettings: (k) => {
      if (!store[k]) store[k] = {};
      return store[k];
    },
    saveNow: () => {}
  });

  // Call .cuz with value: "Mia's MDX"
  const jid = "user1@s.whatsapp.net";
  await registeredHandler(fakeSock, { key: { remoteJid: jid } }, ["Mia's", "MDX"]);

  // Menu card was sent
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].content.caption || sentMessages[0].content.text, /Mia's MDX/);

  // Now user replies with option 2 (Bot Name)
  const handled = await cuz.handleCuzReply(
    fakeSock,
    { key: { remoteJid: jid } },
    "2",
    {
      getSettings: (k) => store[k],
      saveNow: () => {},
      CONFIG
    }
  );

  assert.equal(handled, true);
  assert.equal(CONFIG.BOT_NAME, "Mia's MDX");
  const lastMsg = sentMessages[sentMessages.length - 1];
  assert.match(lastMsg.content.text, /Bot Name.*changed to:.*Mia's MDX/i);
});

test("Arbitrary chat text (like 'Omo broke rn') is never intercepted by cuz", async () => {
  const cuz = await import("../mias/features/cuzCustomization.cjs");
  let sentMessages = [];
  const fakeSock = {
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: "test-reply" } };
    }
  };

  const CONFIG = { BOT_NAME: "MIA'S MDX", PREFIX: "." };

  // Random messages sent in chat without cuz card quote or 1-17 number
  const chatMessages = [
    "Omo broke rn Ntn dey aza",
    "Omor okay What wrong with ur bot",
    "Omo dunno bro",
    "hey how are you doing",
    "send me the link"
  ];

  for (const text of chatMessages) {
    const handled = await cuz.handleCuzReply(
      fakeSock,
      { key: { remoteJid: "user2@s.whatsapp.net" }, message: { conversation: text } },
      text,
      {
        getSettings: () => ({}),
        saveNow: () => {},
        CONFIG
      }
    );
    assert.equal(handled, false, `Message "${text}" must return false from cuz handler`);
  }

  assert.equal(sentMessages.length, 0, "No messages should be sent by cuz for normal chat");
  assert.equal(CONFIG.BOT_NAME, "MIA'S MDX", "Bot name must remain unchanged");
});

test("Numeric option without pending value refuses waiting-value mode", async () => {
  const cuz = await import("../mias/features/cuzCustomization.cjs");
  let sentMessages = [];
  const fakeSock = {
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { key: { id: "test-reply" } };
    }
  };

  const CONFIG = { BOT_NAME: "MIA'S MDX", PREFIX: "." };
  const jid = "freshuser@s.whatsapp.net";

  // Fresh user quoting the cuz card with "2" but never supplied a value via .cuz <value>
  const fakeQuotedMsg = {
    key: { remoteJid: jid },
    message: {
      extendedTextMessage: {
        text: "2",
        contextInfo: {
          quotedMessage: {
            conversation: "╭━━〔 𝐂𝐔𝐒𝐓𝐎𝐌𝐈𝐙𝐄 〕━━╮\n1. Prefix\n2. Bot Name"
          }
        }
      }
    }
  };

  const handled = await cuz.handleCuzReply(
    fakeSock,
    fakeQuotedMsg,
    "2",
    {
      getSettings: () => ({}),
      saveNow: () => {},
      CONFIG
    }
  );

  assert.equal(handled, true);
  const lastMsg = sentMessages[sentMessages.length - 1];
  assert.match(lastMsg.content.text, /Invalid command: empty value field/i);
  assert.equal(CONFIG.BOT_NAME, "MIA'S MDX", "Bot name must not be modified");
});

test("Pairing client uses WhatsApp Web Chrome fingerprint and has notification debug", async () => {
  const pairCode = fs.readFileSync("/tmp/repo/pair.js", "utf8");
  const miasCode = fs.readFileSync("/tmp/repo/mias/index.js", "utf8");
  const caseCode = fs.readFileSync("/tmp/repo/case.js", "utf8");

  assert.ok(
    pairCode.includes('Browsers.ubuntu("Chrome")') || pairCode.includes('["Ubuntu", "Chrome", "20.0.04"]'),
    "pair.js should use standard Chrome browser fingerprint for pairing push notifications"
  );
  assert.ok(
    !pairCode.includes('Browsers.macOS("Desktop")'),
    "pair.js must not use Desktop platform ID which suppresses pairing push notifications"
  );
  assert.ok(
    !miasCode.includes('Browsers.macOS("Desktop")'),
    "mias/index.js must not use Desktop platform ID"
  );

  assert.ok(
    pairCode.includes("NO_NOTIFICATION_DETECTED"),
    "pair.js should have NO_NOTIFICATION_DETECTED diagnostics"
  );
  assert.ok(
    pairCode.includes("pairEvents"),
    "pair.js should export and use pairEvents"
  );

  // Verify ss command is registered in both case.js and mias/index.js
  assert.ok(caseCode.includes("case 'ss':"), "case.js must support .ss command");
  assert.ok(caseCode.includes("s0.wp.com/mshots"), "case.js must use high-reliability screenshot fallbacks");
  assert.ok(miasCode.includes('"ss"'), "mias/index.js must support .ss command");
  assert.ok(miasCode.includes("s0.wp.com/mshots"), "mias/index.js must use high-reliability screenshot fallbacks");
});
