import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnimeEditFlow,
  buildNarutoSearchQueries,
  NARUTO_HASHTAGS,
  NARUTO_RESULTS,
  JJK_RESULTS,
  JJK_HASHTAGS,
  DEMON_SLAYER_HASHTAGS,
  DEMON_SLAYER_RESULTS,
  TIKWM_SEARCH_ENDPOINTS,
  buildDemonSlayerSearchQueries,
  canonicalUrl,
  configuredSourceVideoUrls,
  configuredSourcePages,
  isDemonSlayerEditTitle,
  isNarutoEditTitle,
} from "../mias/features/animeEdits.js";
import { parseCommand } from "../mias/lib/prefix.cjs";

test(".Naruto is routed to the remote anime-edit shortcut", () => {
  const flow = createAnimeEditFlow({ prefix: "." });
  const parsed = parseCommand(".Naruto", ".");

  assert.equal(parsed.isCommand, true);
  assert.equal(parsed.command, "naruto");
  assert.equal(flow.resolve(parsed.command)?.slug, "naruto");
  assert.equal(flow.resolve(parsed.command)?.query, "Naruto");
});

test("raw anime commands resolve when no prefix is configured", () => {
  const flow = createAnimeEditFlow({ prefix: "" });
  const parsed = parseCommand("Naruto", null);

  assert.equal(parsed.isCommand, true);
  assert.equal(parsed.command, "naruto");
  assert.equal(flow.resolve(parsed.command)?.slug, "naruto");
});

test("built-in anime shortcuts all resolve through the same pipeline", () => {
  const flow = createAnimeEditFlow({ prefix: "." });
  for (const command of [
    "naruto",
    "jjk",
    "onepiece",
    "bleach",
    "demonslayer",
    "dragonball",
    "attackontitan",
    "sololeveling",
    "myheroacademia",
    "onepunchman",
    "blackclover",
    "chainsawman",
    "tokyorevengers",
    "bluelock",
  ]) {
    assert.ok(flow.resolve(command), `missing anime shortcut: ${command}`);
  }
});

test("unknown anime-title commands are not routed to the edit pipeline", () => {
  const flow = createAnimeEditFlow({ prefix: "." });
  assert.equal(flow.resolve("animeedit"), null);
  assert.equal(flow.resolve("vinlandsaga"), null);
});

test("Naruto uses exactly two hashtag results and the working TikWM search route", () => {
  assert.equal(NARUTO_RESULTS, 2);
  assert.ok(NARUTO_HASHTAGS.length >= 2);
  const normalizedHashtags = NARUTO_HASHTAGS.map((hashtag) =>
    hashtag.replace(/^#+/, "").toLowerCase(),
  );
  assert.equal(new Set(normalizedHashtags).size, normalizedHashtags.length);
  for (const hashtag of [
    "#sakuraharuno",
    "#borutotwobluevortex",
    "#otsutsukiedits",
    "#shinjutsupowers",
    "#narutoedits4k",
    "#perfectsusanoo",
    "#tentailsedits",
  ]) {
    assert.ok(
      normalizedHashtags.includes(hashtag.slice(1)),
      `missing requested hashtag: ${hashtag}`,
    );
  }
  assert.ok(
    TIKWM_SEARCH_ENDPOINTS.every((endpoint) => endpoint.endsWith("/api/feed/search/")),
    "TikWM hashtag search must use the slash JSON endpoint",
  );

  const flow = createAnimeEditFlow({ prefix: "." });
  const registered = [];
  flow.registerCommands((command, metadata) => registered.push({ command, metadata }));
  const naruto = registered.find((item) => item.command === "naruto");
  assert.ok(naruto);
  assert.match(naruto.metadata.desc, /Send 2 random HD Naruto edits/);
});

test("Naruto search shuffles its own hashtag pool", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const queries = buildNarutoSearchQueries();
    assert.equal(queries.length, NARUTO_HASHTAGS.length);
    assert.equal(new Set(queries).size, queries.length);
    assert.ok(queries.every((query) => /^#[a-z0-9]+$/i.test(query)));
  } finally {
    Math.random = originalRandom;
  }
});

test("canonical URL keys collapse duplicate TikTok links", () => {
  assert.equal(
    canonicalUrl("HTTPS://WWW.TIKTOK.COM/@creator/video/123/?is_from_webapp=1"),
    "https://www.tiktok.com/@creator/video/123",
  );
  assert.equal(
    canonicalUrl("https://www.tiktok.com/@creator/video/123#share"),
    "https://www.tiktok.com/@creator/video/123",
  );
});

test("configured TikTok source pool contains the supplied shared URLs", () => {
  const sources = configuredSourceVideoUrls("naruto");
  assert.equal(sources.length, 0);
  assert.equal(JJK_RESULTS, 2);
  assert.ok(JJK_HASHTAGS.length >= 2);
});

test("the supplied vm links remain page-only sources", () => {
  const pages = configuredSourcePages("naruto");
  assert.equal(pages.length, 37);
  assert.ok(pages.every((url) => /^https:\/\/(?:vm|www)\.tiktok\.com\//i.test(url)));
  assert.ok(pages.includes("https://vm.tiktok.com/ZS9S4SvHhaF3W-Lgjvi/"));
  assert.ok(pages.includes("https://vm.tiktok.com/ZS9S4K8sqBvwE-B7mO8/"));
});

test("Naruto rejects plain and AI-style clips without the edit hashtag", () => {
  assert.equal(isNarutoEditTitle("Naruto"), false);
  assert.equal(isNarutoEditTitle("Naruto AI generated animation"), false);
  assert.equal(isNarutoEditTitle("Obito edit #narutoedit #naruto"), true);
  assert.equal(isNarutoEditTitle("Sasuke edit #narutoedits #uchiha"), true);
});

test("Demon Slayer uses the supplied hashtag pool and two-result limit", () => {
  assert.equal(DEMON_SLAYER_RESULTS, 2);
  const normalized = DEMON_SLAYER_HASHTAGS.map((tag) =>
    tag.replace(/^#+/, "").toLowerCase(),
  );
  assert.equal(new Set(normalized).size, normalized.length);
  for (const tag of [
    "#demonslayer",
    "#kimetsunoyaiba",
    "#tanjiroaura",
    "#rengoku4k",
    "#uppermoon",
    "#infinitycastle",
  ]) {
    assert.ok(normalized.includes(tag.slice(1)), `missing requested hashtag: ${tag}`);
  }
  const queries = buildDemonSlayerSearchQueries();
  assert.equal(queries.length, DEMON_SLAYER_HASHTAGS.length);
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.every((query) => DEMON_SLAYER_HASHTAGS.includes(query)));
});

test("both anime filters reject AI and animation markers", () => {
  for (const title of [
    "Tanjiro edit #demonslayeredit #aianime",
    "Rengoku animated edit #rengokuedit",
    "Naruto edit #narutoedit AI generated",
    "Sasuke edit #narutoedits 3D render",
  ]) {
    assert.equal(isDemonSlayerEditTitle(title) || isNarutoEditTitle(title), false, title);
  }
  assert.equal(
    isDemonSlayerEditTitle("Tanjiro aura edit #demonslayeredit #kny"),
    true,
  );
});