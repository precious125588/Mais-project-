import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const IDX = fs.readFileSync(new URL("../mias/index.js", import.meta.url), "utf8");
const PLAY = fs.readFileSync(new URL("../mias/features/playCommands.js", import.meta.url), "utf8");
const mfBlock = () => {
  const start = IDX.indexOf('cmd(["mediafire", "mediafire2"');
  return IDX.slice(start, IDX.indexOf("// .unzip / .extract", start));
};

test("take: sticker EXIF uses the 22-byte header, value offset 0x16 points at the JSON", () => {
  assert.ok(IDX.includes("Buffer.from([0x16, 0x00, 0x00, 0x00]), _tkJson"), "offset added before the JSON");
  const json = Buffer.from(JSON.stringify({ "sticker-pack-name": "pack", "sticker-pack-publisher": "me", emojis: ["✨"] }), "utf8");
  const head = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]);
  const len = Buffer.alloc(4); len.writeUInt32LE(json.length, 0);
  const exif = Buffer.concat([head, len, Buffer.from([0x16, 0x00, 0x00, 0x00]), json]);
  assert.equal(exif.readUInt32LE(14), json.length, "payload length at bytes 14..17");
  assert.equal(exif.readUInt32LE(18), 22, "value offset at bytes 18..21");
  assert.equal(exif.subarray(22).toString("utf8"), json.toString("utf8"), "JSON starts at offset 22");
});

test("mediafire: file type from the name, then from the bytes, never a generic BIN for a zip", () => {
  const src = IDX.slice(IDX.indexOf("function mediafireMime"), IDX.indexOf("const MEDIAFIRE_EXT_BY_MIME"));
  const mediafireMime = new Function("Buffer", `${src}; return mediafireMime;`)(Buffer);
  assert.equal(mediafireMime("50% Aimbot drag boost by Hasin xits.zip", Buffer.from("xx")), "application/zip");
  assert.equal(mediafireMime("noext", Buffer.from("PK\x03\x04rest-of-zip-data")), "application/zip");
  assert.equal(mediafireMime("tool.apk", Buffer.from("PK\x03\x04")), "application/vnd.android.package-archive");
  assert.equal(mediafireMime("doc", Buffer.from("%PDF-1.4 ...")), "application/pdf");
  assert.equal(mediafireMime("thing.xyzq", Buffer.from("????????")), "application/octet-stream");
});

test("mediafire: sends with the real MIME, deletes the progress message on success", () => {
  const b = mfBlock();
  assert.ok(b.includes("mimetype: mime, fileName: outName"), "document uses the detected MIME and name");
  assert.ok(!b.includes('mimetype: "application/octet-stream", fileName: fname'), "no generic octet-stream for every file");
  assert.ok(b.includes("sock.sendMessage(jid, { delete: stKey })"), "progress message removed when done");
  assert.ok(!/✅ \*Done!\* \$\{fname\}/.test(b), "no 'Done!' text left in the chat");
  assert.ok(b.includes('react(sock, msg, "🌀")') && b.includes('react(sock, msg, "✅")') && b.includes('react(sock, msg, "❌")'), "reactions kept");
  assert.ok(b.includes("MediaFire download failed"), "clear error message kept");
});

test("pinterest: pin.it short links are expanded, shared collections get a clear message", () => {
  assert.ok(IDX.includes("async function expandPinLink(u)"), "short-link expander");
  assert.ok(IDX.includes("const _pinUrl = await expandPinLink(args[0]);"), "expanded before the download APIs");
  assert.ok(IDX.includes("/\\/multi-pin-share\\//i.test(_pinUrl)"), "shared collection detected");
  assert.ok(IDX.includes("This link is a shared collection, not a single pin."), "clear message for collections");
});

test("play: new fallbacks are added at the end of the existing lists", () => {
  const audio = PLAY.slice(PLAY.indexOf("async function _fetchYtAudioBuf"), PLAY.indexOf("for (const fn of dlApis)"));
  const nxA = audio.indexOf("api.nexray.eu.cc/downloader/ytmp3");
  assert.ok(nxA > audio.indexOf("getYupraDownloadByUrl"), "Nexray MP3 is after the existing sources");
  const videoStart = IDX.indexOf("async function _p2VideoBuf(meta)");
  const videoLoop = IDX.indexOf("\n  for (const t of tries)", videoStart);
  const nxV = IDX.indexOf("nxGet('/downloader/ytmp4'", videoStart);
  assert.ok(nxV > videoStart && nxV < videoLoop, "Nexray MP4 added to the video fallback list");
  assert.ok(nxV > IDX.indexOf("api.nekorinn.my.id/downloader/ytmp4", videoStart), "after the existing video sources");
});
