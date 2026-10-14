import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = "/tmp/repo";

test("Downloader consolidation - Protected parent commands are intact", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  // 1. .aio is registered with aliases ["aio","alldl","universaldl"]
  assert.ok(miasIndex.includes('cmd(["aio","alldl","universaldl"]'), "Parent .aio must be registered");

  // 2. .tiktok is registered with aliases ["tiktok","tt","ttdl"]
  assert.ok(miasIndex.includes('cmd(["tiktok","tt","ttdl"]'), "Parent .tiktok must be registered");

  // 3. .ytmp4 is registered with aliases ["ytmp4","ytvideo","yt4","ytv"]
  assert.ok(miasIndex.includes('cmd(["ytmp4","ytvideo","yt4","ytv"]'), "Parent .ytmp4 must be registered");

  // 4. .play late registration is intact for ["play", "music", "song"]
  assert.ok(miasIndex.includes('for (const n of ["play", "music", "song"])'), "Parent .play must be registered");
});

test("Downloader consolidation - Redundant commands are cleanly removed", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");
  const playCommands = fs.readFileSync(path.join(ROOT, "mias/features/playCommands.js"), "utf8");
  const nexrayBot = fs.readFileSync(path.join(ROOT, "mias/nexray_bot.cjs"), "utf8");

  const removedCommands = [
    'cmd(["tiktokv4"',
    'cmd(["ytmp3v2"',
    'cmd(["ytmp4v2"',
    'cmd(["tiktokv2"',
    'cmd(["tiktokv3"',
    'cmd(["ttvideoonly"',
    'cmd(["tiktokslide"',
    'cmd(["dcytmp3"',
    'cmd(["dcytmp4"',
    'cmd(["dcaio"',
    'cmd(["play_jinx_disabled"',
    'cmd(["play_legacy_disabled"'
  ];

  for (const cmd of removedCommands) {
    assert.ok(!miasIndex.includes(cmd), `mias/index.js must not register ${cmd}`);
    assert.ok(!playCommands.includes(cmd), `playCommands.js must not register ${cmd}`);
  }

  // Ensure nexray_bot does not overwrite ytmp4
  assert.ok(!nexrayBot.includes("cmd(['ytmp4']"), "nexray_bot must not register colliding ytmp4");
  assert.ok(nexrayBot.includes("cmd(['nxytmp4']"), "nexray_bot should register nxytmp4");
});

test("Downloader consolidation - Fallback APIs integrated into protected parents", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  // .aio has DavidCyril AIO endpoints integrated as fallback
  assert.ok(miasIndex.includes("_dcMp3Eps = ['/download/ytmp3'"), "dcytmp3 endpoints must be in .play _p2AudioBuf");
  assert.ok(miasIndex.includes('/api/download/mp3'), "Prince API endpoints must be in .play _p2AudioBuf");

  // .ytmp4 has dcytmp4 and Prince API endpoints integrated
  assert.ok(miasIndex.includes('_dcMp4Eps = ["/download/ytmp4"'), "dcytmp4 endpoints must be in .ytmp4 dlApis");
  assert.ok(miasIndex.includes('/api/download/mp4'), "Prince API endpoints must be in .ytmp4 dlApis");

  // .tiktok has Prexzy and Prince API endpoints in provider list
  assert.ok(miasIndex.includes('prexzyGet("/download/tiktokV2"'), "Prexzy V2 must be in .tiktok fallback providers");
  assert.ok(miasIndex.includes('prexzyGet("/download/tiktokV3"'), "Prexzy V3 must be in .tiktok fallback providers");
  assert.ok(miasIndex.includes('prexzyGet("/download/tiktokvideo"'), "Prexzy video-only must be in .tiktok fallback providers");
  assert.ok(miasIndex.includes('_paGet("/api/download/tiktokdlv4"'), "Prince API tiktokv4 must be in .tiktok fallback providers");

  // .aio has DC AIO fallback
  assert.ok(miasIndex.includes('// ── DC AIO fallback (from dcaio) ──'), "DC AIO fallback must be in .aio");
});

test("Downloader consolidation - Unique commands remain untouched", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  // Check sample unique commands from Group C
  assert.ok(miasIndex.includes('cmd(["video","yt","ytdl"'), "Unique command .video must remain");
  assert.ok(miasIndex.includes('cmd(["facebook", "fb"]'), "Unique command .facebook must remain");
  assert.ok(miasIndex.includes('cmd(["instagram","ig","igdl"]'), "Unique command .instagram must remain");
  assert.ok(miasIndex.includes('cmd(["spotify","spot","spotdl"]'), "Unique command .spotify must remain");
  assert.ok(miasIndex.includes('cmd(["pinterest", "pinsearch"'), "Unique command .pinterest must remain");
  assert.ok(miasIndex.includes('cmd("savetube"'), "Unique command .savetube must remain");
  assert.ok(miasIndex.includes('cmd("leaktube"'), "Unique command .leaktube must remain");
  assert.ok(miasIndex.includes('cmd(["moviedl"]'), "Unique command .moviedl must remain");
  assert.ok(miasIndex.includes('cmd(["douyin"'), "Unique command .douyin must remain");
  assert.ok(miasIndex.includes('cmd(["snapchat"'), "Unique command .snapchat must remain");
});
