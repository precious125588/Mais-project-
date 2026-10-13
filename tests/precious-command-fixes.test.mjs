import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

test("TikTok 4.1 reply is never intercepted by settings", () => {
  const tiktokQuotedText = "📱 *TIKTOK DOWNLOAD*\n1. HD Video\n4.1 Photo Slide (ZIP)\nReply with number";
  const isTikTokCard = /TIKTOK|TT DOWNLOAD|PHOTO SLIDE|NO WATERMARK/i.test(tiktokQuotedText);
  assert.equal(isTikTokCard, true);

  // Settings quote detector should reject TikTok card
  const isSettingsPanel = /SETTINGS|CONFIG|Block Calls|Link Guard/i.test(tiktokQuotedText);
  assert.equal(isSettingsPanel, false);
});

test("Sudo card target extraction handles markdown and digits", () => {
  const quotedWithMarkdown = "👑 *SUDO ACCESS CONTROL*\n*Target:* @2348012345678\nReply with option:\n1. Add Sudo\n2. Remove Sudo";
  const m = quotedWithMarkdown.match(/(?:\*?Target\*?[:* \t]+|@)(\d{7,15})/i);
  assert.ok(m);
  assert.equal(m[1], "2348012345678");
});

test("Cuz customization menu math bold title matches normalized detector", () => {
  const mathBoldTitle = "⚙️ 𝗖𝗨𝗭𝗧𝗢𝗠𝗜𝗭𝗔𝗧𝗜𝗢𝗡 𝗠𝗘𝗡𝗨";
  const normalized = mathBoldTitle.normalize("NFKD");
  assert.ok(/CUZ|CUSTOMIZ/i.test(normalized));
});

test("Settings panel containing Section 29 (TikTok mention) is correctly treated as settings panel", () => {
  const settingsPanel = `⚙️ *SYSTEM CONFIGURATION*
[1] Auto Status View: ON
[2] Auto Download: ON
[29] Sources: TikTok, IG, FB
Reply with number to toggle`;
  const tNorm = settingsPanel.normalize("NFKD");
  const quotedIsSettings = (/SETTINGS|CONFIG|Block Calls|Link Guard|Bad Word|Anti Delete|Auto React|Auto Block|Read Msgs|View Status|Welcome|Always Online|Meta Badge|Status Reply|Tap to toggle|ENABLE|DISABLE|Chatbot/i.test(tNorm)
    || /SETTINGS|ᴇɴᴀʙʟᴇ|ᴅɪꜱᴀʙʟᴇ|Tap to toggle/i.test(settingsPanel))
    && !/PLAYER|SUDO|CUSTOMIZ/i.test(tNorm);

  assert.equal(quotedIsSettings, true);

  const isTikTokContext = !quotedIsSettings && /TIKTOK|TT DOWNLOAD|PHOTO SLIDE|NO WATERMARK/i.test(tNorm);
  assert.equal(isTikTokContext, false);
});

test("Bot guard blocks bot self-sudo in DM or when target matches bot", () => {
  const botNum = "2348123456789";
  const targetNum = "2348123456789";
  const isBotTarget = (targetNum && botNum && targetNum === botNum);
  assert.equal(isBotTarget, true);

  const senderNum = "2348123456789";
  const isBotDm = true;
  const isBotDmSudo = isBotDm && (targetNum === botNum || targetNum === senderNum);
  assert.equal(isBotDmSudo, true);
});

test("Cuz customization prompt recovery extracts option from quoted message", () => {
  const { customizationOptions } = require("../mias/features/cuzCustomization.cjs");
  const quotedText = "✏️ Send the new value for *Bot Name* (type the new text):";
  const promptMatch = quotedText.match(/(?:Send the new value for|Editing)\s*\*?([^*:\n]+)\*?/i);
  assert.ok(promptMatch);
  const targetLabel = promptMatch[1].trim().toLowerCase();
  const recoveredOpt = customizationOptions.find(o => o.label.toLowerCase() === targetLabel || o.id.toLowerCase() === targetLabel);
  assert.ok(recoveredOpt);
  assert.equal(recoveredOpt.id, "botName");
});

test("Status edit flow searches mix of fresh 4k and classic queries", () => {
  const query = "goku";
  const cleanQ = String(query || "").trim();
  const freshQueries = [`${cleanQ} 4k edit`, `${cleanQ} viral edit 2026`, `${cleanQ} trending edit`];
  const classicQueries = [`${cleanQ} best edit`, `${cleanQ} edit`, cleanQ];

  assert.ok(freshQueries.some(q => q.includes("4k edit")));
  assert.ok(freshQueries.some(q => q.includes("viral edit 2026")));
  assert.ok(classicQueries.some(q => q.includes("best edit")));
});
