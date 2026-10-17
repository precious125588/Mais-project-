import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SPOT = fs.readFileSync(new URL("../mias/features/spotifyCommands.js", import.meta.url), "utf8");
const IDX = fs.readFileSync(new URL("../mias/index.js", import.meta.url), "utf8");

test("spotify caption uses the premium layout with no emoji-number glyphs or vertical borders", () => {
  assert.ok(SPOT.includes("━━━━━ 𝙎𝙋𝙊𝙏𝙄𝙁𝙔 𝘿𝙊𝙒𝙉𝙇𝙊𝘼𝘿 ━━━━━"), "heading present");
  assert.ok(SPOT.includes("Reply to this message with 1, 2, or 3 to choose your format."), "reply instruction present");
  assert.ok(SPOT.includes("𝙋𝙊𝙒𝙀𝙍𝙀𝘿 𝘽𝙔 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x"), "footer brand present");
  assert.ok(!/1️⃣|2️⃣|3️⃣/.test(SPOT.slice(SPOT.indexOf("function buildCard"), SPOT.indexOf("function buildCard") + 1200)), "no emoji-number glyphs in caption");
  assert.ok(!SPOT.includes("Bot Owner"), "no Bot Owner heading");
});

test("mediafire rebuilt with multi-source fallback and 🌀 / ✅ / ❌ reactions", () => {
  const start = IDX.indexOf('cmd(["mediafire", "mediafire2"');
  const block = IDX.slice(start, IDX.indexOf("// .unzip / .extract", start));
  for (const src of ["Nexray", "Prexzy", "Nexoracle", "Direct page"]) assert.ok(block.includes(`"${src}"`), `source ${src} present`);
  assert.ok(block.includes('react(sock, msg, "🌀")'), "start reaction");
  assert.ok(block.includes('react(sock, msg, "✅")'), "success reaction");
  assert.ok(block.includes('react(sock, msg, "❌")'), "error reaction");
  assert.ok(block.includes("MediaFire download failed"), "clear error message");
});

test("pinterest tries Nexray first and uses 🌀 / ✅ / ❌ reactions", () => {
  assert.ok(IDX.includes('nxGet("/downloader/pinterest", { url: _pinUrl }'), "nexray pinterest source added");
  assert.ok(IDX.includes('await react(sock, msg, "🌀");\n  const input = args.join(" ");'), "start reaction is 🌀");
  assert.ok(IDX.includes("Pinterest download failed.* No source could fetch this pin"), "clear pinterest error");
});

test("shutdown flushes every store before exit", () => {
  assert.ok(IDX.includes("function _flushAllStoresSync()"), "flush helper exists");
  assert.ok(IDX.includes("saveAllData({"), "flush helper snapshots every application store");
  assert.ok(IDX.includes("await flushPersistence();"), "shutdown waits for queued database writes");
  assert.ok(IDX.includes("await closePersistence();"), "shutdown closes the database pool");
  assert.ok(
    /process\.on\("SIGTERM", \(\) => \{ void _shutdown\("SIGTERM"\); \}\);/.test(IDX),
    "SIGTERM awaits the graceful persistence flush",
  );
  assert.ok(
    /process\.on\("SIGINT",\s+\(\) => \{ void _shutdown\("SIGINT"\); \}\);/.test(IDX),
    "SIGINT awaits the graceful persistence flush",
  );
});
