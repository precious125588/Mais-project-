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
