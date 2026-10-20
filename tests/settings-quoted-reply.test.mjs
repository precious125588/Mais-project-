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
const mapStart = source.indexOf("const SETTINGS_MAP = globalThis.SETTINGS_MAP = {");
const mapEnd = source.indexOf("\n};", mapStart) + 3;
assert.ok(mapStart >= 0 && mapEnd > mapStart, "settings action map is present");
const mapContext = {
  setWorkModeState: (settings, mode) => { settings.workMode = mode; },
  getSettings: () => ({}),
};
const productionSettingsMap = vm.runInNewContext(
  source.slice(mapStart, mapEnd) + "\nSETTINGS_MAP;",
  mapContext,
);
const visibleSettingsSource = source.slice(
  source.indexOf("function buildSettingsMenu("),
  mapStart,
);
const visibleSettingChoices = [...visibleSettingsSource.matchAll(/┃\s*(\d{1,2}\.\d{1,2})\b/g)]
  .map(match => match[1]);

function makeHandler({ pendingPicker = false, settingsMap, initialState } = {}) {
  const state = initialState || { antiDelete: false };
  const replies = [];
  const settingsSession = new Map();
  const sandbox = {
    __v31Unwrap: value => value,
    __miasHasPendingPicker: () => pendingPicker,
    __ttGetSelection: () => null,
    settingsSession,
    SETTINGS_MAP: settingsMap || {
      "1.1": settings => { settings.antiDelete = true; return "Anti-Delete enabled"; },
      "1.2": settings => { settings.antiDelete = false; return "Anti-Delete disabled"; },
      "2.1": settings => { settings.antiLink = true; settings.linkGuard = "delete"; return "Anti-Link delete"; },
      "2.2": settings => { settings.antiLink = true; settings.linkGuard = "kick"; return "Anti-Link kick"; },
      "2.3": settings => { settings.antiLink = true; settings.linkGuard = "warn"; return "Anti-Link warn"; },
    },
    CONFIG: { OWNER_NUMBER: "123456789", PREFIX: "." },
    getSettings: () => state,
    getSender: msg => msg?.sender || msg?.key?.participant || msg?.key?.remoteJid || "",
    isOwner: sender => String(sender).replace(/:\d+(?=@)/g, "") === "123456789@s.whatsapp.net",
    isCreator: () => false,
    isSudo: () => false,
    isGroupAdmin: async () => false,
    resolveLid: value => value,
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

test("every numeric choice rendered by the settings UI reaches its production action", async () => {
  assert.ok(visibleSettingChoices.length >= 80, `expected full settings menu, found ${visibleSettingChoices.length} choices`);
  const missing = [...new Set(visibleSettingChoices)].filter(choice => typeof productionSettingsMap[choice] !== "function");
  assert.deepEqual(missing, [], "each visible choice must have a settings action");

  for (const choice of [...new Set(visibleSettingChoices)]) {
    const { handler, replies, settingsSession } = makeHandler({
      settingsMap: productionSettingsMap,
      initialState: {},
    });
    const owner = "123456789@s.whatsapp.net";
    settingsSession.set(owner, { sender: owner, ts: Date.now() });
    const msg = { key: { remoteJid: owner }, sender: owner, message: { conversation: choice } };

    assert.equal(await handler({}, msg, choice), true, `${choice} should be handled`);
    assert.equal(replies.length, 1, `${choice} should acknowledge the setting`);
    assert.ok(replies[0].length > 0, `${choice} should return text`);
    assert.equal(settingsSession.get(owner)?.sender, owner, `${choice} should keep the panel bound to its opener`);
  }
});

test("each Link Guard choice enables anti-link and keeps its selected action", async () => {
  for (const [choice, mode] of [["2.1", "delete"], ["2.2", "kick"], ["2.3", "warn"]]) {
    const owner = "123456789@s.whatsapp.net";
    const scoped = makeHandler({
      settingsMap: productionSettingsMap,
      initialState: { antiLink: false },
    });
    scoped.settingsSession.set(owner, { sender: owner, ts: Date.now() });
    const msg = { key: { remoteJid: owner }, sender: owner, message: { conversation: choice } };
    assert.equal(await scoped.handler({}, msg, choice), true);
    assert.equal(scoped.state.antiLink, true);
    assert.equal(scoped.state.linkGuard, mode);
    assert.match(scoped.replies[0], /Anti-Link: ON/);
  }
});

test("a settings session cannot be changed by another group member", async () => {
  const { handler, state, replies, settingsSession } = makeHandler();
  const group = "120363000000000000@g.us";
  settingsSession.set(group, { sender: "123456789@s.whatsapp.net", ts: Date.now() });
  const msg = {
    key: { remoteJid: group, participant: "2348000000000@s.whatsapp.net" },
    sender: "2348000000000@s.whatsapp.net",
    message: { conversation: "1.1" },
  };

  assert.equal(await handler({}, msg, "1.1"), false);
  assert.equal(state.antiDelete, false);
  assert.equal(replies.length, 0);
});

test("a stale quoted settings panel does not authorize a non-admin member", async () => {
  const { handler, state, replies } = makeHandler();
  const member = "2348000000000@s.whatsapp.net";
  const msg = {
    key: { remoteJid: "120363000000000000@g.us", participant: member },
    sender: member,
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

  assert.equal(await handler({}, msg, "1.1"), false);
  assert.equal(state.antiDelete, false);
  assert.equal(replies.length, 0);
});
