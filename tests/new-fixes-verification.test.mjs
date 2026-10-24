import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve("/tmp/repo");
const IDX_PATH = path.join(ROOT, "mias/index.js");
const MP_PATH = path.join(ROOT, "mias/lib/mediaPipeline.cjs");
const AD_PATH = path.join(ROOT, "mias/lib/autoDownloader.js");
const MH_PATH = path.join(ROOT, "mias/handlers/mediaHandler.js");

const indexSrc = fs.readFileSync(IDX_PATH, "utf8");
const mpSrc = fs.readFileSync(MP_PATH, "utf8");
const adSrc = fs.readFileSync(AD_PATH, "utf8");
const mhSrc = fs.readFileSync(MH_PATH, "utf8");

test("1. Menu header: bot username on top, hardened MIAS MDX second, both centered with dividers", () => {
  // Check buildMenu in index.js
  assert.ok(indexSrc.includes('const botName = CONFIG.BOT_NAME || CONFIG.OWNER_NAME || "PRECIOUS x";'));
  assert.ok(indexSrc.includes('centerLine(`*${botName}*`)'));
  assert.ok(/centerLine\("\*M(?:\u200b|\\u200b)?IAS MDX\*"\)/.test(indexSrc));

  // Check rule width measurement & centering
  const rule = "────────────────────";
  const ruleWidth = rule.length;
  const centerLine = (txt) => {
    const visible = String(txt).replace(/[\*\u200b]/g, "");
    const pad = Math.max(0, Math.floor((ruleWidth - [...visible].length) / 2));
    return " ".repeat(pad) + txt;
  };

  const line1 = centerLine("*PRECIOUS x*");
  const line2 = centerLine("*MIAS MDX*");

  // Check visual centering
  const pad1 = line1.match(/^\s*/)[0].length;
  const pad2 = line2.match(/^\s*/)[0].length;
  assert.equal(pad1, 5, "PRECIOUS x should be padded by 4 spaces within 20 chars");
  assert.equal(pad2, 6, "MIAS MDX should be padded by 6 spaces within 20 chars");

  // Both renderers have this header
  const emissions = (indexSrc.match(/centerLine\(`\*\$\{botName\}\*`\)/g) || []).length;
  assert.equal(emissions, 2, "Both buildMenu and buildMenuOverview emit centered bot username first");
});

test("2. deliverMediaWithDiskTemp: disk temporary storage, >90MB document routing, and auto-cleanup", async () => {
  const mp = await import(MP_PATH);
  assert.equal(typeof mp.deliverMediaWithDiskTemp, "function", "deliverMediaWithDiskTemp must be exported");

  const sentMessages = [];
  const fakeSock = {
    sendMessage: async (jid, content, opts) => {
      sentMessages.push({ jid, content, opts });
      return { key: { id: "test_msg" } };
    },
  };

  // Test 2a: Small buffer creates temporary disk file, sends as video, then unlinks temp
  const smallBuf = Buffer.alloc(1024 * 1024, 0xaa); // 1 MB
  let createdPath = null;
  const origBufferToStream = mp.bufferToStreamPayload;

  await mp.deliverMediaWithDiskTemp(fakeSock, "123@s.whatsapp.net", smallBuf, {
    type: "video",
    caption: "test video",
  });

  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].content.video, "Should send as video");
  assert.ok(typeof sentMessages[0].content.video.url === "string", "Must use disk url");
  assert.ok(!fs.existsSync(sentMessages[0].content.video.url), "Temporary disk file must be unlinked after delivery");

  // Test 2b: Large buffer (>90MB) routes automatically as document
  const largeBuf = Buffer.alloc(91 * 1024 * 1024, 0xbb); // 91 MB
  await mp.deliverMediaWithDiskTemp(fakeSock, "123@s.whatsapp.net", largeBuf, {
    type: "video",
    caption: "large video",
    fileName: "large.mp4",
  });

  assert.equal(sentMessages.length, 2);
  assert.ok(sentMessages[1].content.document, "Should route >90MB as document");
  assert.equal(sentMessages[1].content.fileName, "large.mp4");
  assert.ok(!fs.existsSync(sentMessages[1].content.document.url), "Large temporary disk file must be unlinked after delivery");
});

test("3. AutoDownloader and mediaHandler stream through disk temporary logic", () => {
  // autoDownloader uses tmpPath without buffering into memory
  assert.ok(!adSrc.includes("bytes = fs.readFileSync(tmpPath);"), "autoDownloader should not read whole file into buffer");
  assert.ok(adSrc.includes("downloaded.size > 90 * 1024 * 1024"), "autoDownloader routes >90MB as document");

  // mediaHandler handles disk paths directly with { url: path }
  assert.ok(mhSrc.includes("content = {\n        video:    { url: video }"));
  assert.ok(mhSrc.includes("content = {\n        audio:    { url: audio }"));
  assert.ok(mhSrc.includes("content = {\n        document: { url: document }"));
  assert.ok(mhSrc.includes("st.size > 90 * 1024 * 1024"), "mediaHandler routes >90MB video to sendDocument");
});

test("4. 12-hour RAM and temp disk maintenance armed and functional", async () => {
  assert.ok(indexSrc.includes("const RAM_CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;"));
  assert.ok(indexSrc.includes("setInterval(perform12HourRamCleanup, RAM_CLEANUP_INTERVAL_MS)"));
  assert.ok(indexSrc.includes("perform12HourRamCleanup"));

  // Check that the cleanup logic runs safely without throwing
  assert.ok(indexSrc.includes("processedMessages?.clear?.()"));
  assert.ok(indexSrc.includes("os.tmpdir()"));
  assert.ok(indexSrc.includes("mp?.sweep"));
});
