/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           MIAS MDX — Database / Persistence Layer           ║
 * ║           Saves economy, settings, bans to JSON files       ║
 * ║           Owner: 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x                              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, "database");

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_FILES = {
  economy:      path.join(DB_DIR, "economy.json"),
  settings:     path.join(DB_DIR, "settings.json"),
  bans:         path.join(DB_DIR, "bans.json"),
  warns:        path.join(DB_DIR, "warns.json"),
  sudo:         path.join(DB_DIR, "sudo.json"),
  badwords:     path.join(DB_DIR, "badwords.json"),
  inventory:    path.join(DB_DIR, "inventory.json"),
  relationships:path.join(DB_DIR, "relationships.json"),
  factions:     path.join(DB_DIR, "factions.json"),
  userfaction:  path.join(DB_DIR, "userfaction.json"),
  crypto:       path.join(DB_DIR, "crypto.json"),
  grouprules:   path.join(DB_DIR, "grouprules.json"),
};

// ── Serialization helpers for Map ────────────────────────────
function mapToObj(map) {
  const obj = {};
  for (const [k, v] of map) {
    if (v instanceof Map) obj[k] = { __isMap: true, data: mapToObj(v) };
    else if (v instanceof Set) obj[k] = { __isSet: true, data: [...v] };
    else obj[k] = v;
  }
  return obj;
}

function objToMap(obj) {
  const map = new Map();
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && v.__isMap) map.set(k, objToMap(v.data));
    else if (v && typeof v === "object" && v.__isSet) map.set(k, new Set(v.data));
    else map.set(k, v);
  }
  return map;
}

function setToArr(set) { return [...set]; }
function arrToSet(arr) { return new Set(arr); }

// ── Save a Map to a JSON file ───────────────────────────────
function saveMap(filePath, map) {
  try {
    const data = JSON.stringify(mapToObj(map), null, 2);
    fs.writeFileSync(filePath, data, "utf8");
  } catch (e) {
    console.error(`[DB] Failed to save ${path.basename(filePath)}:`, e.message);
  }
}

// ── Load a Map from a JSON file ─────────────────────────────
function loadMap(filePath) {
  try {
    if (!fs.existsSync(filePath)) return new Map();
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return new Map();
    return objToMap(JSON.parse(raw));
  } catch (e) {
    console.error(`[DB] Failed to load ${path.basename(filePath)}:`, e.message);
    return new Map();
  }
}

// ── Save a Set to a JSON file ───────────────────────────────
function saveSet(filePath, set) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(setToArr(set), null, 2), "utf8");
  } catch (e) {
    console.error(`[DB] Failed to save ${path.basename(filePath)}:`, e.message);
  }
}

// ── Load a Set from a JSON file ─────────────────────────────
function loadSet(filePath) {
  try {
    if (!fs.existsSync(filePath)) return new Set();
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return new Set();
    return arrToSet(JSON.parse(raw));
  } catch (e) {
    console.error(`[DB] Failed to load ${path.basename(filePath)}:`, e.message);
    return new Set();
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Load all data stores from disk.
 * Returns an object with all loaded Maps and Sets.
 */
export function loadAllData() {
  console.log("📂 Loading database from disk...");
  const data = {
    economy:       loadMap(DB_FILES.economy),
    settings:      loadMap(DB_FILES.settings),
    bans:          loadMap(DB_FILES.bans),
    warns:         loadMap(DB_FILES.warns),
    sudo:          loadSet(DB_FILES.sudo),
    badwords:      loadMap(DB_FILES.badwords),
    inventory:     loadMap(DB_FILES.inventory),
    relationships: loadMap(DB_FILES.relationships),
    factions:      loadMap(DB_FILES.factions),
    userfaction:   loadMap(DB_FILES.userfaction),
    crypto:        loadMap(DB_FILES.crypto),
    grouprules:    loadMap(DB_FILES.grouprules),
  };
  const ecoCount = data.economy.size;
  const settCount = data.settings.size;
  console.log(`✅ Database loaded: ${ecoCount} economy records, ${settCount} settings records`);
  return data;
}

/**
 * Save all data stores to disk.
 * Call this periodically and on shutdown.
 */
export function saveAllData(stores) {
  saveMap(DB_FILES.economy,       stores.economy);
  saveMap(DB_FILES.settings,      stores.settings);
  saveMap(DB_FILES.bans,          stores.bans);
  saveMap(DB_FILES.warns,         stores.warns);
  saveSet(DB_FILES.sudo,          stores.sudo);
  saveMap(DB_FILES.badwords,      stores.badwords);
  saveMap(DB_FILES.inventory,     stores.inventory);
  saveMap(DB_FILES.relationships, stores.relationships);
  saveMap(DB_FILES.factions,      stores.factions);
  saveMap(DB_FILES.userfaction,   stores.userfaction);
  saveMap(DB_FILES.crypto,        stores.crypto);
  saveMap(DB_FILES.grouprules,    stores.grouprules);
}

/**
 * Start auto-save interval (default: every 2 minutes).
 * Returns the interval ID so you can clear it.
 */
export function startAutoSave(stores, intervalMs = 120000) {
  console.log(`💾 Auto-save enabled (every ${intervalMs / 1000}s)`);
  const id = setInterval(() => {
    saveAllData(stores);
  }, intervalMs);

  // Also save on process exit
  const graceful = () => {
    console.log("💾 Saving data before exit...");
    saveAllData(stores);
    process.exit(0);
  };
  process.on("SIGINT", graceful);
  process.on("SIGTERM", graceful);

  return id;
}

export { DB_DIR, DB_FILES };
