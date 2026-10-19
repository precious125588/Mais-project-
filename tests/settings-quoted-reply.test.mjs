import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(ROOT, "mias", "index.js"), "utf8");
const handlerStart = source.lastIndexOf("handleSettingsNumericReply = async function (sock, msg, body) {");
const handlerEnd = source.indexOf("\n  // ══ 10. CHATBOT COMMAND", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "active quoted-settings handler is present");

function makeHandler({ pendingPicker = false } = {}) {
  const state = { antiDelete: false };
  const replies = [];
  const settingsSession = new Map();
  const sandbox = {
    __v31Unwrap: value => value,
    __miasHasPendingPicker: () => pendingPicker,
    __ttGetSelection: () => null,
    settingsSession,
    SETTINGS_MAP: {
      "1.1": settings => { settings.antiDelete = true; return "Anti-Delete enabled"; },
      "1.2": settings => { settings.antiDelete = false; return "Anti-Delete disabled"; },
    },
    CONFIG: { OWNER_NUMBER: "123456789", PREFIX: "." },
    getSettings: () => state,
    saveNow: () => {},
    sendReply: async (_sock, _msg, text) => replies.push(text),
  };
  vm.runInNewContext(source.slice(handlerStart, handlerEnd), sandbox);
  return { handler: sandbox.handleSettingsNumericReply, state, replies, settingsSession };
}

test("quoting a settings panel image and replying 1.1 updates the setting and responds", async () => {
  const { handler, state, replies } = makeHandler();
  const msg = {
    key: { remoteJid: "123456789@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "1.1",
        contextInfo: {
          quotedMessage: {
            imageMessage: { caption: "⚙️ SETTINGS & CONFIG — Reply with an option" },
          },
        },
      },
    },
  };

  assert.equal(await handler({}, msg, "1.1"), true);
  assert.equal(state.antiDelete, true);
  assert.ok(replies.some(reply => reply.includes("Anti-Delete enabled")));
});

test("a quoted TikTok picker reply is left for the picker instead of being swallowed by settings", async () => {
  const { handler } = makeHandler({ pendingPicker: true });
  const msg = {
    key: { remoteJid: "123456789@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "1.1",
        contextInfo: { quotedMessage: { conversation: "TikTok download menu" } },
      },
    },
  };

  assert.equal(await handler({}, msg, "1.1"), false);
});
