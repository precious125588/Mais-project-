// =========================================================================
//  welcomeCards.cjs — Jimp-based welcome/goodbye image cards with the
//  TARGET MEMBER'S USERNAME rendered INSIDE the image beside the avatar.
//
//  Root-cause context: the repo's passport card
//  (mias/index.js globalThis._passportCard) already lays out a circular
//  avatar on the left and title/subtitle text on the right — but the
//  welcome/goodbye event handler called it WITHOUT passing the member's
//  name, so the area beside the avatar stayed empty. This module is the
//  renderer the event handler now calls with the resolved target name.
//
//  Rendering safety:
//   • Unicode / emoji / long names are wrapped and hard-clipped to the
//     text box (x = avatar-right, width = card-minus-avatar) so nothing
//     overflows the card or overlaps the avatar.
//   • Jimp's print() with a max width + height clips glyphs to the box.
//   • No username is ever hardcoded; a safe fallback chain is applied.
// =========================================================================
'use strict';

const Jimp = require('jimp');

const W = 640, H = 300, PAD = 18;
const AV = 150;               // avatar diameter
const AV_X = PAD + 17;        // avatar left
const TEXT_X = AV_X + AV + 24; // text starts right of the avatar + gutter
const TEXT_W = W - TEXT_X - PAD; // clip width so text never leaves the card

// ── safe text helpers ────────────────────────────────────────────────────
function _truncate(str, max) {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
// strip characters that break layout (control chars, zero-width joiners ok)
function _sanitize(str) {
  return String(str || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')   // control chars
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render a welcome/goodbye card.
 * @param {Buffer|null} avatarBuf  member profile image (fallback used if null)
 * @param {string} label           "WELCOME" | "GOODBYE" (top bar)
 * @param {string} username        the TARGET member's display name/username
 * @param {string} sub             extra line (group / member count)
 * @returns {Promise<Buffer>}      JPEG image buffer
 */
async function renderMemberCard(avatarBuf, label, username, sub) {
  const base = new Jimp(W, H, 0x171a21ff);
  const bar = new Jimp(W, 58, label === 'GOODBYE' ? 0xb03a48ff : 0x2f80edff);
  base.composite(bar, 0, 0);
  const inner = new Jimp(W - PAD * 2, H - 58 - PAD - 10, 0x232936ff);
  base.composite(inner, PAD, 58 + 8);

  // avatar (fallback to a neutral disc when the DP can't be fetched)
  let avatar;
  try { avatar = avatarBuf ? await Jimp.read(avatarBuf) : new Jimp(AV, AV, 0x4b5563ff); }
  catch { avatar = new Jimp(AV, AV, 0x4b5563ff); }
  avatar.cover(AV, AV).circle();
  const ring = new Jimp(AV + 10, AV + 10, 0x2f80edff).circle();
  base.composite(ring, AV_X - 5, 58 + 22 - 5);
  base.composite(avatar, AV_X, 58 + 22);

  const fontBar  = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  const fontName = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
  const fontSub  = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

  base.print(fontBar, 18, 18, { text: String(label || ''), alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT }, W - 36, 30);

  // ── the TARGET username beside the circular profile image ─────────────
  const name = _truncate(_sanitize(username) || 'Member', 26);
  base.print(
    fontName,
    TEXT_X, 58 + 40,
    { text: name, alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT },
    TEXT_W, 48,            // clip box — prevents overflow / overlap
  );
  if (sub) {
    base.print(
      fontSub,
      TEXT_X, 58 + 96,
      { text: _truncate(_sanitize(sub), 60), alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT },
      TEXT_W, 90,
    );
  }
  return base.quality(88).getBufferAsync(Jimp.MIME_JPEG);
}

module.exports = { renderMemberCard };
