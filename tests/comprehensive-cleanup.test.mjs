import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

test("Cleanup - Virtual number and temporary SMS commands are removed", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  
  const removedVnumCmds = [
    'cmd(["smscountries"',
    'cmd(["vnum"',
    'cmd(["vnummsg"',
    'cmd(["veepcountries"',
    'cmd(["veepnum"',
    'cmd(["veepmsg"',
    'cmd(["dctempnumber"',
    'cmd(["dcvmsgs"'
  ];
  for (const cmdStr of removedVnumCmds) {
    assert.ok(!miasIndex.includes(cmdStr), `Virtual number command registration ${cmdStr} must be removed`);
  }
});

test("Cleanup - Joke commands are removed from runtime and static configs", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  const menuConfig = fs.readFileSync(path.join(ROOT, "mias/handlers/menuConfig.js"), "utf8");

  assert.ok(!miasIndex.includes('cmd("joke",'), 'Runtime cmd("joke") must be removed');
  assert.ok(!miasIndex.includes('cmd(["joke2"'), 'Runtime cmd(["joke2"]) must be removed');
  assert.ok(!menuConfig.includes('{ name: "joke"'), 'Static menuConfig joke must be removed');
});

test("Cleanup - Categories ECONOMY, RANDOM, and TEXT are permanently removed", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  const menuConfig = fs.readFileSync(path.join(ROOT, "mias/handlers/menuConfig.js"), "utf8");

  assert.ok(!miasIndex.includes('name: "ECONOMY"'), 'ECONOMY category must be removed from runtime MENU_CATEGORIES');
  assert.ok(!miasIndex.includes('name: "RANDOM"'), 'RANDOM category must be removed from runtime MENU_CATEGORIES');
  assert.ok(!miasIndex.includes('name: "TEXT"'), 'TEXT category must be removed from runtime MENU_CATEGORIES');
  assert.ok(!menuConfig.includes('cat_account'), 'cat_account must be removed from static menuConfig');

  // Verify economy commands blocks removed
  assert.ok(!miasIndex.includes('cmd(["money", "wallet"'), 'Standard economy command block must be removed');
  assert.ok(!miasIndex.includes('cmd("createfaction"'), 'Faction economy command block must be removed');
  
  // Verify random generator loops removed
  assert.ok(!miasIndex.includes('_PREXZY_RANDOM_MAP'), '_PREXZY_RANDOM_MAP must be removed');
  assert.ok(!miasIndex.includes('_ANIME_WALLS'), '_ANIME_WALLS must be removed');
});

test("Cleanup - Protected downloaders are intact", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  assert.ok(miasIndex.includes('for (const n of ["play", "music", "song"])'), "Protected command .play must remain");
  assert.ok(miasIndex.includes('cmd(["tiktok","tt","ttdl"]'), "Protected command .tiktok must remain");
  assert.ok(miasIndex.includes('cmd(["ytmp4","ytvideo","yt4","ytv"]'), "Protected command .ytmp4 must remain");
  assert.ok(miasIndex.includes('cmd(["aio","alldl","universaldl"]'), "Protected command .aio must remain");

  // Verify play 4 options/features remain in playCommands.js
  const playCmds = fs.readFileSync(path.join(ROOT, "mias/features/playCommands.js"), "utf8");
  assert.ok(playCmds.includes("ytmp3") || playCmds.includes("audio"), "Play audio option exists");
  assert.ok(playCmds.includes("ytmp4") || playCmds.includes("video"), "Play video option exists");
});

test("Cleanup - Consolidated commands have canonical visible in categories and aliases hidden", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  // Download canonicals
  assert.ok(miasIndex.includes('"twitter"'), "Twitter canonical in DOWNLOAD");
  assert.ok(miasIndex.includes('"spotify"'), "Spotify canonical in DOWNLOAD");
  assert.ok(miasIndex.includes('"facebook"'), "Facebook canonical in DOWNLOAD");
  assert.ok(miasIndex.includes('"pinterest"'), "Pinterest canonical in DOWNLOAD");
  assert.ok(miasIndex.includes('"mediafire"'), "Mediafire canonical in DOWNLOAD");
  assert.ok(miasIndex.includes('"apk"'), "APK canonical in DOWNLOAD");

  // Search canonicals
  assert.ok(miasIndex.includes('"wiki"'), "Wiki canonical in SEARCH");
  assert.ok(miasIndex.includes('"lyrics"'), "Lyrics canonical in SEARCH");
  assert.ok(miasIndex.includes('"google"'), "Google canonical in SEARCH");
  assert.ok(miasIndex.includes('"github"'), "Github canonical in SEARCH");
  assert.ok(miasIndex.includes('"spotisearch"'), "Spotisearch canonical in SEARCH");

  // Tools canonicals
  assert.ok(miasIndex.includes('"qr"'), "QR canonical in TOOLS");
  assert.ok(miasIndex.includes('"define"'), "Define canonical in SEARCH");
  assert.ok(miasIndex.includes('"shorten"'), "Shorten canonical in TOOLS");
  assert.ok(miasIndex.includes('"ip"'), "IP canonical in TOOLS");
  assert.ok(miasIndex.includes('"ss"'), "SS canonical in TOOLS");
});
