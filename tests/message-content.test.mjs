import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const content = require("../mias/lib/messageContent.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("quoted context is found through nested view-once, device-sent, and edited wrappers", () => {
  const msg = {
    key: { remoteJid: "chat@s.whatsapp.net" },
    message: {
      deviceSentMessage: {
        message: {
          viewOnceMessageV2Extension: {
            message: {
              editedMessage: {
                message: {
                  extendedTextMessage: {
                    text: ".quote",
                    contextInfo: {
                      stanzaId: "quoted-id",
                      quotedMessage: { conversation: "the quoted text" },
                      mentionedJid: ["person@s.whatsapp.net"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const context = content.getContextInfo(msg);
  assert.equal(context.stanzaId, "quoted-id");
  assert.equal(content.extractTextFromMessage(context.quotedMessage), "the quoted text");
  assert.deepEqual(context.mentionedJid, ["person@s.whatsapp.net"]);
});

test("document-wrapped image media keeps Baileys download type while exposing image semantics", () => {
  const quoted = {
    documentWithCaptionMessage: {
      message: {
        documentMessage: {
          mimetype: "image/webp",
          fileName: "sticker-converted.webp",
          fileLength: 9000,
        },
      },
    },
  };

  const media = content.findMediaNode(quoted);
  assert.equal(media.type, "image");
  assert.equal(media.messageType, "documentMessage");
  assert.equal(media.downloadType, "document");
  assert.equal(media.mimetype, "image/webp");
  assert.equal(media.fileName, "sticker-converted.webp");
});

test("quoted sticker and image messages remain distinguishable from documents", () => {
  const sticker = content.findMediaNode({
    viewOnceMessageV2: { message: { stickerMessage: { mimetype: "image/webp" } } },
  });
  const image = content.findMediaNode({ imageMessage: { mimetype: "image/jpeg" } });

  assert.equal(sticker.type, "sticker");
  assert.equal(sticker.downloadType, "sticker");
  assert.equal(image.type, "image");
  assert.equal(image.downloadType, "image");
});

test("text extraction unwraps wrappers used by quoted command and media captions", () => {
  const msg = {
    message: {
      documentWithCaptionMessage: {
        message: {
          imageMessage: { caption: "caption inside a wrapper" },
        },
      },
    },
  };
  assert.equal(content.extractTextFromMessage(msg), "caption inside a wrapper");
});

test("canonical quote context is exposed to legacy handlers for captioned media commands", () => {
  const quotedMessage = { documentMessage: { mimetype: "image/webp", fileName: "converted.webp" } };
  const contextInfo = { stanzaId: "quote-123", quotedMessage };
  const msg = {
    message: {
      imageMessage: {
        caption: ".image-command",
        contextInfo,
      },
    },
  };

  content.attachCanonicalQuoteContext(msg, contextInfo);
  assert.equal(msg.message.imageMessage.caption, ".image-command");
  assert.equal(msg.message.extendedTextMessage.contextInfo.quotedMessage, quotedMessage);
  assert.equal(msg.message.extendedTextMessage.contextInfo.stanzaId, "quote-123");
});

test("the command and media handlers share the wrapper-aware quote/media parser", () => {
  const index = fs.readFileSync(path.join(ROOT, "mias", "index.js"), "utf8");
  const downloader = fs.readFileSync(path.join(ROOT, "mias", "handlers", "downloadHandler.js"), "utf8");
  const utilities = fs.readFileSync(path.join(ROOT, "mias", "handlers", "utilityHandler.js"), "utf8");

  assert.match(index, /deviceSentMessage\?\.message\)\s*cur = cur\.deviceSentMessage\.message/);
  assert.match(index, /editedMessage\?\.message\)\s*cur = cur\.editedMessage\.message/);
  assert.match(index, /return __miasMessageContent\.getContextInfo\(msg\)/);
  assert.match(index, /__miasMessageContent\.attachCanonicalQuoteContext\(msg, quoteContext\)/);
  assert.match(downloader, /getContextInfo\(msg\)\?\.quotedMessage/);
  assert.match(downloader, /findMediaNode\(quotedMsg\)/);
  assert.match(utilities, /return extractTextFromMessage\(msg\)/);
  assert.match(utilities, /const context = getContextInfo\(msg\)/);
});
