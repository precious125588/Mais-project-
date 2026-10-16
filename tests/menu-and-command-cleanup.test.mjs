import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

test("Menu format has bold uppercase labels and no emojis in categories or headers", async () => {
  const indexSource = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  const premiumMenu = await import("../mias/lib/premiumMenus.js");

  // Check buildMenu header and category format in index.js
  assert.ok(indexSource.includes('"COMMAND CATEGORIES\\n"'), "Menu header must be clean text without emojis");
  assert.ok(indexSource.includes("${cat.name.toUpperCase()}"), "Categories must be uppercase");
  assert.ok(!indexSource.includes("🗂️ *CATEGORIES*"), "Old emoji category header must not exist in index.js");
  assert.ok(!indexSource.includes("━━━━━「 *CATEGORIES* 」━━━━━"), "Decorative header must be gone from index.js");

  // formatMenuCategory in premiumMenus.js
  const formatted = premiumMenu.formatMenuCategory({ name: "download", cmds: ["facebook", "tiktok"] });
  assert.ok(formatted.includes("*DOWNLOAD*"), "formatMenuCategory must render uppercase bold name");
  assert.ok(!formatted.includes("🟨"), "formatMenuCategory must not have yellow square emoji");
});

test("Menu categories INTELLIGENCE, ANIMATION, TTS, UTILITY are excluded from menu", async () => {
  const premiumMenu = await import("../mias/lib/premiumMenus.js");
  for (const cat of ["INTELLIGENCE", "ANIMATION", "TTS", "UTILITY"]) {
    assert.ok(premiumMenu.REMOVED_MENU_CATEGORIES.has(cat), `Category ${cat} must be in REMOVED_MENU_CATEGORIES`);
  }

  const indexSource = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  assert.ok(indexSource.includes('"ANIMATION", "INTELLIGENCE", "TTS", "UTILITY"'), "index.js MENU_CATEGORIES splice must include new exclusions");
});

test("Facebook is canonical and related commands are hidden aliases", () => {
  const indexSource = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  // Facebook canonical registration
  assert.ok(indexSource.includes('cmd(["facebook", "fb"]'), "facebook must be registered");
  assert.ok(indexSource.includes('for (const _fbAlias of ["fb-dl", "fbdl", "facebook-dl"'), "fb-dl aliases must be registered");

  // In DOWNLOAD category of MENU_CATEGORIES, only facebook is listed
  const downloadMatch = indexSource.match(/name:\s*"DOWNLOAD"[^}]+cmds:\s*\[([^\]]+)\]/);
  assert.ok(downloadMatch, "DOWNLOAD category must exist");
  const downloadCmds = downloadMatch[1];
  assert.ok(downloadCmds.includes('"facebook"'), 'DOWNLOAD category must include "facebook"');
  assert.ok(!downloadCmds.includes('"fb-dl"'), 'DOWNLOAD category must not include "fb-dl"');
  assert.ok(!downloadCmds.includes('"fbdl"'), 'DOWNLOAD category must not include "fbdl"');
  assert.ok(!downloadCmds.includes('"facebook-dl"'), 'DOWNLOAD category must not include "facebook-dl"');
});

test("Protected image card player is intact with 1-4 menu, obsolete play families removed", () => {
  const indexSource = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  const playCommands = fs.readFileSync(path.join(ROOT, "mias/features/playCommands.js"), "utf8");

  // Verify protected card text
  assert.ok(indexSource.includes("───── 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 × PLAYER ─────"), "Protected card header must be intact");
  assert.ok(indexSource.includes("1 - Audio"), "Option 1 Audio must be intact");
  assert.ok(indexSource.includes("2 - Document (.mp3)"), "Option 2 Document must be intact");
  assert.ok(indexSource.includes("3 - Voice note"), "Option 3 Voice note must be intact");
  assert.ok(indexSource.includes("4 - Video (.mp4)"), "Option 4 Video must be intact");

  // Verify obsolete registrations are removed from playCommands.js
  assert.ok(!playCommands.includes('cmd(["playvid"'), "playvid must not be registered");
  assert.ok(!playCommands.includes('cmd(["play2"'), "play2/playdoc must not be registered");
  assert.ok(!playCommands.includes('cmd(["play!"'), "play! must not be registered");
  assert.ok(!playCommands.includes('cmd(["play2!"'), "play2! must not be registered");
});

test("Groupstatus is the visible canonical and GST aliases are hidden; disabled variants removed", () => {
  const indexSource = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  const gstPicker = fs.readFileSync(path.join(ROOT, "mias/precious-gst-picker.cjs"), "utf8");
  const v20Fixes = fs.readFileSync(path.join(ROOT, "mias/precious-fixes-v20.cjs"), "utf8");

  // GROUP category in index.js includes groupstatus
  const groupMatch = indexSource.match(/name:\s*"GROUP"[^}]+cmds:\s*\[([^\]]+)\]/);
  assert.ok(groupMatch, "GROUP category must exist");
  assert.ok(groupMatch[1].includes('"groupstatus"'), "GROUP category must include groupstatus");
  assert.ok(!groupMatch[1].includes('"gst"'), "GROUP category must not display gst as canonical");

  // gstPicker binds groupstatus as canonical and gst as alias
  assert.ok(gstPicker.includes("bind(['groupstatus', 'gst', 'gstatus', 'gcstatus']"), "gstPicker must bind groupstatus first");
  assert.ok(gstPicker.includes("ex.canonical = canonical;"), "gstPicker must record canonical");

  // disabled variants are removed
  assert.ok(!indexSource.includes('cmd(["gst_legacy_disabled"'), "gst_legacy_disabled must be removed");
  assert.ok(!indexSource.includes('cmd([_jn]'), "gst_jinx_disabled loop must be removed");
  assert.ok(!v20Fixes.includes("e.desc = 'Legacy disabled'"), "gst_v20_disabled must not be registered");
});

test("Canvas, wanted/wasted, musiccard, ramalan, nomer-hoki, arti-nama, weton, random, and tts commands are filtered", () => {
  const nexraySource = fs.readFileSync(path.join(ROOT, "mias/nexray_bot.cjs"), "utf8");
  const indexSource = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  // nexray filter checks
  assert.ok(nexraySource.includes("n.startsWith('canvas-')"), "nexray must filter canvas-");
  assert.ok(nexraySource.includes("n.startsWith('ramalan')"), "nexray must filter ramalan");
  assert.ok(nexraySource.includes("n.startsWith('random')"), "nexray must filter random");
  assert.ok(nexraySource.includes("'wanted'"), "nexray must filter wanted/wasted");
  assert.ok(nexraySource.includes("'musiccard'"), "nexray must filter musiccard");
  assert.ok(nexraySource.includes("'nomer-hoki'"), "nexray must filter nomer-hoki");
  assert.ok(nexraySource.includes("'arti-nama'"), "nexray must filter arti-nama");
  assert.ok(nexraySource.includes("'weton'"), "nexray must filter weton");

  // index.js cmd() filter checks
  assert.ok(indexSource.includes('if (cat === "TTS") return;'), "index.js cmd() must filter category TTS");
  assert.ok(indexSource.includes("rawList.some(isTts)"), "index.js cmd() must filter TTS commands");
  assert.ok(indexSource.includes('rawList[0].startsWith("dc")'), "index.js cmd() must filter DC commands");
});
