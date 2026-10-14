"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SETTINGS_FILE = path.join(ROOT, "database", "bot_settings.json");

function readPersistedPrefix() {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    if (Object.prototype.hasOwnProperty.call(data, "prefix")) {
      return data.prefix;
    }
  } catch {}
  return undefined;
}

// HARD RULE: prefix is ALWAYS "." unless a REAL custom symbol is set.
// null / none / off / "" / "no" / "disabled" / "noprefix" / "no-prefix" are ALL
// mapped to "." — there is no no-prefix mode anymore. Only `aza` and `send`
// are accepted raw (handled in parseCommand). This kills the permanent
// null/none prefix-leak for good.
function normalizePrefix(value) {
  if (value === null || value === undefined) return ".";
  const text = String(value).trim();
  if (!text || /^(?:null|none|off|no|false|disabled|noprefix|no-prefix)$/i.test(text)) return ".";
  return text.slice(0, 3);
}

function getConfiguredPrefix() {
  const persisted = readPersistedPrefix();
  if (persisted !== undefined) return normalizePrefix(persisted);
  const env = process.env.PREFIX;
  return env === undefined ? "." : normalizePrefix(env);
}

function saveConfiguredPrefix(value) {
  const prefix = normalizePrefix(value);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {}
  data.prefix = prefix;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2) + "\n");
  return prefix;
}

function parseCommand(body, prefix = getConfiguredPrefix()) {
  const input = String(body || "").trim();
  if (!input) return { isCommand: false, command: "", args: [], text: "" };

  const lower = input.toLowerCase();
  // aza & send are the ONLY commands that also work raw (no prefix).
  for (const exception of ["aza", "send"]) {
    if (new RegExp(`^${exception}(?:\\s|$)`, "i").test(lower)) {
      const tokens = input.split(/\s+/);
      tokens.shift();
      return { isCommand: true, command: exception, args: tokens, text: tokens.join(" ") };
    }
  }

  // Everything else REQUIRES the prefix. An unset prefix defaults to "."
  // and must never turn every ordinary message into a command.
  const effectivePrefix = typeof prefix === "string" && prefix.length ? prefix : ".";
  if (!input.startsWith(effectivePrefix)) {
    return { isCommand: false, command: "", args: [], text: "" };
  }

  const source = input.slice(effectivePrefix.length).trim();
  const tokens = source ? source.split(/\s+/) : [];
  const command = (tokens.shift() || "").toLowerCase();
  return { isCommand: Boolean(command), command, args: tokens, text: tokens.join(" ") };
}

module.exports = {
  getConfiguredPrefix,
  normalizePrefix,
  parseCommand,
  saveConfiguredPrefix,
};
