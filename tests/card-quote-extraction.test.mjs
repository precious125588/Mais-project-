import test from "node:test";
import assert from "node:assert/strict";

// Helper simulating extraction from incoming Baileys messages
function extractQuotedText(msg) {
  function __v31Unwrap(m) {
    let cur = m;
    for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
      const nxt = cur.ephemeralMessage?.message
        || cur.viewOnceMessage?.message
        || cur.viewOnceMessageV2?.message
        || cur.viewOnceMessageV2Extension?.message
        || cur.documentWithCaptionMessage?.message
        || cur.editedMessage?.message;
      if (!nxt || nxt === cur) break;
      cur = nxt;
    }
    return cur;
  }

  const unwrapped = __v31Unwrap(msg?.message || {});
  const qCtx = unwrapped.extendedTextMessage?.contextInfo
    || unwrapped.imageMessage?.contextInfo
    || unwrapped.videoMessage?.contextInfo
    || unwrapped.documentMessage?.contextInfo
    || unwrapped.interactiveResponseMessage?.contextInfo
    || msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo;

  const q = __v31Unwrap(qCtx?.quotedMessage || {});
  const qArr = [];
  const recTxt = (o) => {
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (typeof o[k] === "string" && o[k].trim()) qArr.push(o[k]);
      else if (typeof o[k] === "object") recTxt(o[k]);
    }
  };
  recTxt(q);
  return qArr.join(" ");
}

test("Quoted card extraction finds captions in imageMessage inside quotedMessage", () => {
  const replyToImageCard = {
    key: { remoteJid: "1234@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "1",
        contextInfo: {
          participant: "bot@s.whatsapp.net",
          quotedMessage: {
            imageMessage: {
              caption: "👑 *SUDO — ACCESS CONTROL*\n\nTarget: @2348011111111\n\n*1.* Sudo (DM only)\n*2.* Sudo VIP (Group + DM)\n*3.* Remove\n\n_Quote this card and reply with 1, 2 or 3_"
            }
          }
        }
      }
    }
  };

  const text = extractQuotedText(replyToImageCard);
  assert.ok(/SUDO/i.test(text), "Should detect SUDO card");
  assert.ok(/Target: @2348011111111/.test(text), "Should detect target mention in quoted card");
});

test("Quoted card extraction finds captions in viewOnce image inside quotedMessage", () => {
  const replyToViewOnceCard = {
    key: { remoteJid: "1234@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "6.1",
        contextInfo: {
          participant: "bot@s.whatsapp.net",
          quotedMessage: {
            viewOnceMessageV2: {
              message: {
                imageMessage: {
                  caption: "⚙️ *SETTINGS & CONFIG*\n\n6. Anti Delete\n6.1 Enable\n6.2 Disable"
                }
              }
            }
          }
        }
      }
    }
  };

  const text = extractQuotedText(replyToViewOnceCard);
  assert.ok(/SETTINGS/i.test(text), "Should detect SETTINGS panel");
});
