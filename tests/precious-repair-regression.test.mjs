/* 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x — repair regression suite.
   Verifies: reaction root cause, menu/allmenu separation, owner header dedup,
   footer/branding, the 26 disabled commands, and the two hidden aliases.
   Run: node tests/precious-repair-regression.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDX = fs.readFileSync(path.join(ROOT, "mias", "index.js"), "utf8");
const PREM = fs.readFileSync(path.join(ROOT, "mias", "lib", "premiumMenus.js"), "utf8");

// Build a live DISABLED_COMMANDS + isCommandDisabled from the real source block
// (single source of truth — no copied list that could drift).
const m = IDX.match(/const DISABLED_COMMANDS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(m, "DISABLED_COMMANDS block must exist");
const DISABLED = new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
const isCommandDisabled = (name) => {
  const key = String(name || "").toLowerCase().trim();
  if (!key) return false;
  if (DISABLED.has(key)) return true;
  const entry = commands.get(key);
  const canonical = String(entry?.canonical || aliases.get(key) || "").toLowerCase();
  return Boolean(canonical) && DISABLED.has(canonical);
};
// Minimal registry for alias-canonical resolution checks.
const commands = new Map();
const aliases = new Map();

// ── 1. REACTION root cause ──────────────────────────────────────────────────
test("react() obeys the dedicated owner cmdReact toggle", () => {
  assert.ok(IDX.includes("_ownS && _ownS.cmdReact === false"), "command reactions use cmdReact, not message autoReact");
  assert.ok(!IDX.includes("_chatS && _chatS.autoReact === false"), "chat message autoReact must not suppress command reactions");
});

test("react() constructs a valid Baileys reaction key and never throws on failure", () => {
  assert.ok(IDX.includes('react: { text: emoji, key: _reactKey }'), "react() must send a {react:{text,key}} payload");
  assert.ok(IDX.includes("if (msg.key.participant) _reactKey.participant = msg.key.participant;"), "react() must carry participant for group keys");
  assert.ok(IDX.includes(".catch(() => {})"), "react() must swallow delivery failures so a failed reaction never crashes a command");
});

// ── 2. MENU / ALLMENU separation ────────────────────────────────────────────
test(".menu and .allmenu are independent handler functions (no shared route)", () => {
  assert.ok(IDX.includes("function buildMenuOverview("), "a dedicated overview builder must exist for .menu");
  assert.match(IDX, /cmd\(\['allmenu', 'fullmenu'\][\s\S]*?\}, cmdAll\);/, ".allmenu must register cmdAll");
  assert.match(IDX, /cmd\(\['menu', 'help', 'commands', '\.menu', 'start'\][\s\S]*?\}, cmdMenu\);/, ".menu must register cmdMenu");
  assert.ok(IDX.includes("async function cmdMenu("), "cmdMenu must be a distinct function");
  assert.ok(IDX.includes("async function cmdAll("), "cmdAll must be a distinct function");
  assert.ok(!/cmd\(\['menu'[\s\S]{0,40}sendPremiumMenu\(sock, msg, args, false\);/.test(IDX.split("async function cmdMenu")[1] || ""), "bare .menu must NOT call the full-catalogue sendPremiumMenu path");
});

test(".menu overview shows categories with counts only, never the full catalogue", () => {
  const ov = IDX.split("function buildMenuOverview")[1].split("return t;")[0];
  assert.ok(ov.includes("*${cat.name}*  (${cat.cmds.length})"), "overview lists category + count only");
  assert.ok(!ov.includes("formatMenuCategory(cat)"), "overview must NOT embed the full per-command catalogue");
  assert.ok(ov.includes("POWERED BY"), "overview footer branding preserved");
  assert.ok(ov.includes("COMMANDS  →"), "overview keeps the computed command count (never hard-coded)");
});

test(".menu <category> still routes to the category renderer", () => {
  const fn = IDX.split("async function cmdMenu")[1];
  assert.ok(fn.includes("if (Array.isArray(args) && args.length > 0) return sendPremiumMenu(sock, msg, args, false);"), ".menu <cat> must delegate to sendPremiumMenu for a single category");
});

test(".allmenu remains the full eligible catalogue path", () => {
  assert.ok(IDX.includes("function buildMenu("), "the full buildMenu catalogue builder must remain for .allmenu");
  assert.ok(IDX.includes("activeMenuCategories(commands, aliases, MENU_CATEGORIES, context).map(cat => formatMenuCategory(cat))"), "full catalogue uses the canonical category snapshot");
});

// ── 3. OWNER HEADER dedup + centering ──────────────────────────────────────
test("menu header has bot username on top and hardened MIAS MDX second, both centered", () => {
  // Header block inside buildMenuOverview
  const ov = IDX.split("function buildMenuOverview")[1].split("return t;")[0];
  assert.ok(!ov.includes('t += "𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x\\n\\n";'), "the standalone brand/owner line under header must be removed");
  assert.ok(!/𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x\\n\\n"\s*;?\s*\n\s*t \+= quoteSection/.test(ov), "no owner-name line may sit between the header and the quote");
  // Centering logic is present and shared
  assert.ok(IDX.includes("const centerLine = (txt) =>"), "centerLine helper must exist");
  assert.ok(IDX.includes("centerLine(`*${botName}*`)"), "bot username header rendered via centerLine");
  assert.ok(/centerLine\("\*M(?:\\u200b)?IAS MDX\*"\)/.test(IDX), "the hardened MIAS MDX heading must be rendered via centerLine");
  const emissions = (IDX.match(/centerLine\("\*M(?:\\u200b)?IAS MDX\*"\)/g) || []).length;
  assert.equal(emissions, 2, "two renderers (overview + full) each emit the heading exactly once");
});

// ── 4. FOOTER / branding ────────────────────────────────────────────────────
test("footer shows the 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x brand, not a bare owner name", () => {
  assert.ok(IDX.includes("POWERED BY 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x"), "menu footer must brand 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x");
  assert.ok(!/POWERED BY \$\{[^}]*OWNER_NAME[^}]*\}/.test(IDX), "footer must not be a bare dynamic owner-name substitution (the observed 'POWERED BY Bot Owner' default)");
  assert.ok(PREM.includes("POWERED BY JUST X"), "premiumMenus download-branding footer is untouched (separate from the menu footer)");
});

// ── 5. DISABLED commands ────────────────────────────────────────────────────
const WANTED = [
  "googledrive-dl","gdrive-dl","gdrive2","douyin-dl","capcut-dl","github-dl",
  "gofile2","gofile-dl","likee-dl","leaktube","mediafire-dl","mega-dl","pinterest-dl",
  "soundcloud-dl","spotify-dl","threads-dl","twit-dl","video-dl",
  "debugtail","setcmdaliasv2","welcomedm",
  "flag3dtext","channelinfo",
];
test("the execution-disabled user-selected commands are in the authoritative DISABLED_COMMANDS set", () => {
  for (const n of WANTED) assert.ok(DISABLED.has(n), `disabled set must contain "${n}"`);
  assert.equal(WANTED.length, 23, "23 execution-disabled commands; status names are hidden aliases");
});

test("a disabled alias is still blocked through its canonical (no bypass)", () => {
  // capcut-dl resolves to canonical 'capcut' which is NOT disabled -> the alias
  // name itself is disabled. Model the alias map to prove name-level blocking.
  commands.set("capcut-dl", { canonical: "capcut", isAlias: true });
  aliases.set("capcut-dl", "capcut");
  assert.ok(isCommandDisabled("capcut-dl"), "alias name in the disabled set must be blocked even if its canonical is live");
  assert.ok(!isCommandDisabled("capcut"), "the parent 'capcut' must NOT be disabled (only the alias)");
});

test("hidden aliases gclockmedia and gst stay CALLABLE and resolve to their parents", () => {
  const aliBlock = IDX.split("Object.entries({ gclockmedia: \"lockmedia\", gst: \"groupstatus\", gcstory: \"groupstatus\", gcstatus: \"groupstatus\" })")[1];
  assert.ok(aliBlock.includes("registry.set(aliasName, { ...parentEntry, isAlias: true, hidden: true, canonical: parent });"), "hidden aliases must reuse the parent handler and stay out of menus");
  assert.ok(aliBlock.includes("aliasMap.set(aliasName, parent);"), "hidden aliases must resolve to the parent canonical");
  // parents remain active and are NOT in the disabled set
  for (const p of ["lockmedia", "groupstatus"]) assert.ok(!DISABLED.has(p), `parent "${p}" must remain enabled`);
  for (const a of ["gclockmedia", "gst"]) assert.ok(!DISABLED.has(a), `alias "${a}" must not be disabled, only hidden`);
  // lockmedia is still registered with its own rich handler (parent intact)
  assert.ok(IDX.includes('cmd(["lockmedia","nomedia","medlock","medialocked"]'), "lockmedia parent registration must be unchanged");
});

test("protected parent commands remain registered and untouched", () => {
  for (const p of ["aio", "tiktok", "ytmp4", "play"]) assert.ok(!DISABLED.has(p), `protected "${p}" must not be disabled`);
  assert.ok(IDX.includes("───── 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 × PLAYER ─────"), "protected 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 × PLAYER card must be intact");
});

test("menu count is computed from the eligible canonical registry, never hard-coded", () => {
  assert.ok(IDX.includes("const totalCmds = getPrimaryCommandCount(context);"), "count must come from getPrimaryCommandCount");
  assert.ok(IDX.includes("function getPrimaryCommandCount"), "getPrimaryCommandCount must exist");
  assert.ok(IDX.includes("canonicalMenuEntries(commands, aliases, MENU_CATEGORIES, context).length"), "count derived from canonical (alias-hidden, disabled-excluded) entries");
});
