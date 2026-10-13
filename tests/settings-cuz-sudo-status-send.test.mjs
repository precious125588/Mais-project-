import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Initialize v36 fixes with mock context
const installV36 = require("../mias/precious-fixes-v36.cjs");
installV36({
  commands: new Map(),
  CONFIG: { PREFIX: "." },
  sendReply: async () => {},
  react: async (sock, msg, emoji) => {
    if (typeof globalThis.testReact === "function") globalThis.testReact(emoji);
  },
  getBotPic: () => null,
  getSettings: () => ({}),
  getOwnerJid: () => "1111111111@s.whatsapp.net",
  axios: {},
  downloadContentFromMessage: async function* () {}
});

test("remuxVideoFast remuxes an MP4 quickly with faststart flag", async () => {
  const tmpIn = path.join(os.tmpdir(), `test_raw_${Date.now()}.mp4`);
  try {
    execSync(`ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=24 -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -c:v libx264 -pix_fmt yuv420p -c:a aac "${tmpIn}" 2>/dev/null`);
    const inputBuf = fs.readFileSync(tmpIn);
    assert.ok(inputBuf.length > 500, "Input buffer must be created");

    const start = Date.now();
    const remuxed = await globalThis.remuxVideoFast(inputBuf);
    const duration = Date.now() - start;

    assert.ok(Buffer.isBuffer(remuxed));
    assert.ok(remuxed.length > 500);
    // Remuxing should be fast (typically < 300ms in sandbox)
    assert.ok(duration < 4000, `Remux duration too slow: ${duration}ms`);
    // Check that 'moov' atom appears before 'mdat' for faststart
    const moovPos = remuxed.indexOf(Buffer.from("moov"));
    const mdatPos = remuxed.indexOf(Buffer.from("mdat"));
    assert.ok(moovPos !== -1, "moov atom must exist");
    assert.ok(mdatPos !== -1, "mdat atom must exist");
    assert.ok(moovPos < mdatPos, "moov atom must precede mdat atom for faststart streaming");
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
  }
});

test("V36_STATUS_SEND handles status video with fast remux without hanging", async () => {
  const tmpIn = path.join(os.tmpdir(), `test_status_v_${Date.now()}.mp4`);
  try {
    execSync(`ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=24 -c:v libx264 -pix_fmt yuv420p -t 1 "${tmpIn}" 2>/dev/null`);
    const sampleVideo = fs.readFileSync(tmpIn);

    const reactions = [];
    const sentMessages = [];

    globalThis.testReact = (emoji) => reactions.push(emoji);

    const mockSock = {
      sendMessage: async (jid, content) => {
        sentMessages.push({ jid, content });
        return { key: { id: "msg_123" } };
      }
    };

    const mockMsg = {
      key: { remoteJid: "status@broadcast", participant: "1234567890@s.whatsapp.net", fromMe: false },
      message: { conversation: "send pls" }
    };
    const mockQuoted = {
      videoMessage: {
        caption: "My Status Video",
        url: "http://example.com/status.mp4"
      }
    };

    // Re-install v36 with our specific mock downloader yielding sampleVideo
    installV36({
      commands: new Map(),
      CONFIG: { PREFIX: "." },
      sendReply: async () => {},
      react: async (sock, msg, emoji) => reactions.push(emoji),
      getBotPic: () => null,
      getSettings: () => ({}),
      getOwnerJid: () => "1111111111@s.whatsapp.net",
      axios: {},
      downloadContentFromMessage: async function* () {
        yield sampleVideo;
      }
    });

    assert.equal(typeof globalThis.V36_STATUS_SEND, "function");
    await globalThis.V36_STATUS_SEND(mockSock, mockMsg, mockQuoted);

    assert.ok(reactions.includes("🌀"), "Must react with spiral on start");
    assert.ok(reactions.includes("✅"), "Must react with checkmark on success");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].jid, "1234567890@s.whatsapp.net");
    assert.ok(Buffer.isBuffer(sentMessages[0].content.video));
    assert.equal(sentMessages[0].content.caption, "My Status Video");
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {}
  }
});

test("Cuz Customization never intercepts replies quoting Settings or Sudo", async () => {
  const cuzMod = require("../mias/features/cuzCustomization.cjs");

  const settingsQuotedMsg = {
    key: { remoteJid: "123456@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "1.1",
        contextInfo: {
          quotedMessage: {
            conversation: "⚙️ *SETTINGS & CONFIGURATION*\n1.1 Auto React\n1.2 Anti Delete\nTap to toggle"
          }
        }
      }
    }
  };

  const sudoQuotedMsg = {
    key: { remoteJid: "123456@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "1",
        contextInfo: {
          quotedMessage: {
            conversation: "👑 *SUDO — ACCESS CONTROL*\nReply with:\n1. Sudo (DM only)\n2. Sudo VIP\n3. Remove"
          }
        }
      }
    }
  };

  const mockSock = {
    sendMessage: async () => {}
  };

  const resSettings = await cuzMod.handleCuzReply(mockSock, settingsQuotedMsg, "1.1", {});
  assert.equal(resSettings, false, "Cuz must NOT handle reply quoting Settings");

  const resSudo = await cuzMod.handleCuzReply(mockSock, sudoQuotedMsg, "1", {});
  assert.equal(resSudo, false, "Cuz must NOT handle reply quoting Sudo");
});

test("Sudo and Settings quoted router patterns in mias/index.js are mutually exclusive", () => {
  const indexSrc = fs.readFileSync(path.join(process.cwd(), "mias/index.js"), "utf8");
  const v36Src = fs.readFileSync(path.join(process.cwd(), "mias/precious-fixes-v36.cjs"), "utf8");

  // Verify that router checks do not cross-fire
  assert.ok(indexSrc.includes("!/SETTINGS|CONFIG|CUSTOMIZ/i.test(_qNorm)"), "Sudo check must exclude Settings and Cuz");
  assert.ok(indexSrc.includes("!/SUDO|ACCESS CONTROL|CUSTOMIZ/i.test(_qNorm)"), "Settings check must exclude Sudo and Cuz");
  assert.ok(indexSrc.includes("!/SETTINGS|CONFIG|SUDO|ACCESS CONTROL/i.test(_qNorm)"), "Cuz check must exclude Settings and Sudo");

  // Verify that cleanSudoState is called on sudo selection (1, 2, 3)
  assert.ok(indexSrc.includes("cleanSudoState()"), "cleanSudoState must be called");
  assert.ok(indexSrc.includes("globalThis.__lastSudoPending = null;"), "lastSudoPending must be cleared");

  // Verify status send uses remuxVideoFast
  assert.ok(v36Src.includes("remuxVideoFast(rawBuf)"), "V36_STATUS_SEND must call remuxVideoFast");
  assert.ok(indexSrc.includes("globalThis.remuxVideoFast(buf)"), "status inline handler must call remuxVideoFast");
});
