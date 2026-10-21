import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(ROOT, "mias", "index.js"), "utf8");

function createImageReader(downloadContentFromMessage, getContextInfo = (msg) =>
  msg.message?.extendedTextMessage?.contextInfo) {
  const start = source.indexOf("  async function __miasReadImageBuf(sock, msg, args) {");
  const end = source.indexOf("  globalThis.__miasReadImageBuf = __miasReadImageBuf;", start);
  assert.ok(start >= 0 && end > start, "image reader source should be present");
  const fn = new Function(
    "downloadContentFromMessage",
    "getContextInfo",
    "_axios",
    source.slice(start, end) + "\nreturn __miasReadImageBuf;"
  );
  return fn(downloadContentFromMessage, getContextInfo, {});
}

function imageStream(bytes) {
  return (async function* () {
    yield bytes;
  })();
}

test("quoted image documents use Baileys' document download type", async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const doc = { mimetype: "image/jpeg", fileName: "pin.jpg" };
  const calls = [];
  const readImage = createImageReader(async (node, type) => {
    calls.push({ node, type });
    return imageStream(bytes);
  });
  const msg = {
    message: {
      extendedTextMessage: {
        contextInfo: { quotedMessage: { documentMessage: doc } },
      },
    },
  };

  assert.deepEqual(await readImage({}, msg, []), bytes);
  assert.deepEqual(calls, [{ node: doc, type: "document" }]);
});

test("quoted normal images work through an ephemeral wrapper", async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const img = { mimetype: "image/jpeg" };
  const calls = [];
  const readImage = createImageReader(async (node, type) => {
    calls.push({ node, type });
    return imageStream(bytes);
  });
  const msg = {
    message: {
      extendedTextMessage: {
        contextInfo: {
          quotedMessage: { ephemeralMessage: { message: { imageMessage: img } } },
        },
      },
    },
  };

  assert.deepEqual(await readImage({}, msg, []), bytes);
  assert.deepEqual(calls, [{ node: img, type: "image" }]);
});

test("the shared image reader does not unwrap a quoted view-once envelope", async () => {
  let downloads = 0;
  const readImage = createImageReader(async () => {
    downloads++;
    return imageStream(Buffer.from([1, 2, 3]));
  });
  const msg = {
    message: {
      extendedTextMessage: {
        contextInfo: {
          quotedMessage: {
            viewOnceMessage: { message: { imageMessage: { mimetype: "image/jpeg" } } },
          },
        },
      },
    },
  };

  assert.equal(await readImage({}, msg, []), null);
  assert.equal(downloads, 0);
});

test("fulldp uses square full-frame processing and resolves failures visibly", () => {
  const bufferStart = source.indexOf("async function __miasFullDpBuffer(buf) {");
  const bufferEnd = source.indexOf("globalThis.__miasFullDpBuffer", bufferStart);
  const bufferBlock = source.slice(bufferStart, bufferEnd);
  assert.match(bufferBlock, /fit: "inside", withoutEnlargement: true/);
  assert.match(bufferBlock, /composite\(\[\{ input: foreground, gravity: "centre" \}\]\)/);

  const handlerStart = source.indexOf("const __miasFullDpHandler = async (sock, msg, args) => {");
  const handlerEnd = source.indexOf('for (const n of ["fulldp", "setfulldp", "setfullpp", "fullpp"])', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  assert.match(handler, /__miasFullDpBuffer\(buf\)/);
  assert.match(handler, /if \(!buf \|\| buf\.length < 200\)[\s\S]*?react\(sock, msg, "❌"\)/);
  assert.match(handler, /Profile picture upload timed out after 20 seconds/);
  assert.match(handler, /if \(!authorized\)/);
});

test("gst routes quoted images through its media download and image status path", () => {
  const start = source.indexOf("const __gstV23 = async (sock, msg, args) => {");
  const end = source.indexOf('for (const n of ["gst", "gstatus", "groupstatus"])', start);
  const handler = source.slice(start, end);
  assert.match(handler, /const qInner = _v23Inner\(quoted\) \|\| _v23Inner\(direct\)/);
  assert.match(handler, /_v23Download\(qInner\.raw, qInner\.kind\)/);
  assert.match(handler, /if \(isImg\)\s*\{\s*payload = \{ image: buf/);
  assert.match(handler, /sock\.sendMessage\("status@broadcast", payload, statusOpts\)/);
});
