import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

test("prefix parser enforces prefix for regular commands and allows aza/send raw", async () => {
  const { parseCommand } = await import("../mias/lib/prefix.cjs");

  assert.equal(parseCommand("menu", ".").isCommand, false);
  assert.equal(parseCommand("ping", ".").isCommand, false);
  assert.equal(parseCommand(".menu", ".").isCommand, true);
  assert.equal(parseCommand("!menu", "!").isCommand, true);

  // An empty or null prefix falls back to '.' so raw commands are never executed.
  assert.equal(parseCommand("menu", null).isCommand, false);
  assert.equal(parseCommand(".menu", null).isCommand, true);

  // Exact aza and send exceptions work with or without prefix.
  assert.equal(parseCommand("aza", ".").isCommand, true);
  assert.equal(parseCommand("send", ".").isCommand, true);
  assert.equal(parseCommand(".aza", ".").isCommand, true);
  assert.equal(parseCommand(".send", ".").isCommand, true);
});

test("private mode exceptions in mias/index.js and case.js", () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, "mias", "index.js"), "utf8");
  const caseSrc = fs.readFileSync(path.join(ROOT, "case.js"), "utf8");

  assert.match(indexSrc, /if \(\/\^\[\.\\\/!#\]\?aza\\b\/i\.test\(_txt\)\) return false;/);
  assert.match(indexSrc, /if \(\/\^\[\.\\\/!#\]\?send\\b\/i\.test\(_txt\)\) return false;/);
  assert.match(caseSrc, /command !== 'aza' && command !== 'send'/);
  assert.match(indexSrc, /Only aza and send work without a prefix/);
  assert.doesNotMatch(indexSrc, /Commands now work without a prefix, e\.g\. menu or ping/);
});
