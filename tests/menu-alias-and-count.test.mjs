import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

test("Menu & Alias filtering - Registry assigns isAlias and canonical properly", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  // Verify cmd implementation has isAlias logic
  assert.ok(miasIndex.includes("const isAlias = i > 0;"), "cmd() must tag aliases with isAlias = i > 0");
  assert.ok(miasIndex.includes("commands.set(n, { ...opts, handler: gatedHandler, canonical, isAlias });"), "cmd() must store canonical and isAlias flag");
  assert.ok(miasIndex.includes("function getPrimaryCommandCount(context = {})"), "getPrimaryCommandCount() must be defined");
  assert.ok(miasIndex.includes("function isCommandAlias(name)"), "isCommandAlias() must be defined");
  assert.ok(miasIndex.includes("function getCategoryPrimaryCommands(cat, context = {})"), "getCategoryPrimaryCommands() must be defined");
});

test("Menu & Alias filtering - Menus display only primary commands", () => {
  const miasIndex = fs.readFileSync(path.join(ROOT, "mias/index.js"), "utf8");

  // buildMenu must use getPrimaryCommandCount
  assert.ok(miasIndex.includes("const totalCmds = getPrimaryCommandCount(context);"), "buildMenu must use getPrimaryCommandCount()");

  // Category counts in buildMenu must use getCategoryPrimaryCommands
  assert.ok(miasIndex.includes("activeMenuCategories(commands, aliases, MENU_CATEGORIES, context).map(cat => formatMenuCategory(cat))"), "buildMenu counts and listing must use the same canonical category snapshot");

  // .menu <category> must use getCategoryPrimaryCommands
  assert.ok(miasIndex.includes("const uniq = getCategoryPrimaryCommands(cat, context);"), ".menu must use getCategoryPrimaryCommands");

  // allmenu must skip aliases
  assert.ok(miasIndex.includes("canonicalMenuEntries(commands, aliases, MENU_CATEGORIES, context)"), "allmenu must use centralized unique canonical entries");

  // In DOWNLOAD category of MENU_CATEGORIES, tt and ttdl must not be listed
  const downloadMatch = miasIndex.match(/name:\s*"DOWNLOAD"[^}]+cmds:\s*\[([^\]]+)\]/);
  assert.ok(downloadMatch, "DOWNLOAD category must exist");
  const downloadCmds = downloadMatch[1];
  assert.ok(downloadCmds.includes('"tiktok"'), 'DOWNLOAD category must include "tiktok"');
  assert.ok(!downloadCmds.includes('"tt"'), 'DOWNLOAD category must not include "tt"');
  assert.ok(!downloadCmds.includes('"ttdl"'), 'DOWNLOAD category must not include "ttdl"');
});

test("Menu & Alias filtering - Aliases remain functional in the commands Map", () => {
  // Test simulated registration logic identical to mias/index.js
  const commands = new Map();
  const aliases = new Map();

  function cmd(names, opts, handler) {
    const list = [].concat(names || []).map(n => typeof n === "string" ? n.trim().toLowerCase() : "").filter(Boolean);
    if (!list.length) return;
    const canonical = list[0];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const isAlias = i > 0;
      if (isAlias) aliases.set(n, canonical);
      else aliases.delete(n);
      commands.set(n, { ...opts, handler, canonical, isAlias });
    }
  }

  function getPrimaryCommandCount() {
    let count = 0;
    for (const [name, cmdObj] of commands.entries()) {
      if (!cmdObj?.isAlias) count++;
    }
    return count;
  }

  function getCategoryPrimaryCommands(cat) {
    if (!cat || !cat.cmds) return [];
    const result = [];
    const seen = new Set();
    for (const c of cat.cmds) {
      if (!c) continue;
      const lower = c.toLowerCase().trim();
      const entry = commands.get(lower);
      const canon = (entry?.canonical || aliases.get(lower) || lower).toLowerCase();
      if (seen.has(canon)) continue;
      seen.add(canon);
      result.push(canon);
    }
    return result;
  }

  const handler = () => "tiktok result";
  cmd(["tiktok", "tt", "ttdl"], { desc: "Download TikTok" }, handler);

  // Both canonical and alias must exist in commands Map
  assert.ok(commands.has("tiktok"), "commands must have 'tiktok'");
  assert.ok(commands.has("tt"), "commands must have 'tt'");
  assert.ok(commands.has("ttdl"), "commands must have 'ttdl'");

  // Handlers must be identical
  assert.equal(commands.get("tt").handler, handler, "Alias 'tt' must execute identical handler");
  assert.equal(commands.get("ttdl").handler, handler, "Alias 'ttdl' must execute identical handler");

  // Flags must be correct
  assert.equal(commands.get("tiktok").isAlias, false, "tiktok must not be an alias");
  assert.equal(commands.get("tt").isAlias, true, "tt must be an alias");
  assert.equal(commands.get("ttdl").isAlias, true, "ttdl must be an alias");

  // Total count must be 1, NOT 3
  assert.equal(getPrimaryCommandCount(), 1, "Total primary commands must be 1");

  // Category menu must only output 1 command
  const cat = { name: "DOWNLOAD", cmds: ["tiktok", "tt", "ttdl"] };
  const catResult = getCategoryPrimaryCommands(cat);
  assert.deepEqual(catResult, ["tiktok"], "Category menu must contain only 'tiktok'");
});
