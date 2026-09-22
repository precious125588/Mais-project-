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

function normalizePrefix(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || /^(?:null|none|off)$/i.test(text)) return null;
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

  if (prefix !== null) {
    if (!input.startsWith(prefix)) {
      return { isCommand: false, command: "", args: [], text: "" };
    }
  }

  const source = prefix === null ? input : input.slice(prefix.length).trim();
  const tokens = source ? source.split(/\s+/) : [];
  const command = (tokens.shift() || "").toLowerCase();
  return {
    isCommand: Boolean(command),
    command,
    args: tokens,
    text: tokens.join(" "),
  };
}

module.exports = {
  getConfiguredPrefix,
  normalizePrefix,
  parseCommand,
  saveConfiguredPrefix,
};