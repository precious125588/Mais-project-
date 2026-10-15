// Node-hosted menu helpers. No sockets, sessions, timers or startup side effects.
export const REMOVED_MENU_CATEGORIES = new Set(['GAMES', 'TEXTMAKER', 'STALK', 'LOGO', 'FUN']);
const CATEGORY_ALIASES = { GAME: 'GAMES', STALKER: 'STALK', GROUPS: 'GROUP', DOWNLOADS: 'DOWNLOAD', DL: 'DOWNLOAD', MAIN: 'INFO', SYSTEM: 'INFO', SETTING: 'SETTINGS' };
export function normalizeMenuCategory(value) {
  const key = String(value || '').trim().toUpperCase().replace(/^CAT_/, '');
  return CATEGORY_ALIASES[key] || key;
}
export function boldCommand(value) {
  return String(value || '').toUpperCase().replace(/[A-Z]/g, ch => String.fromCodePoint(0x1d400 + ch.charCodeAt(0) - 65));
}
export function canonicalMenuEntries(commands, aliases = new Map(), categories = []) {
  const shared = new Map();
  for (const cat of categories) {
    const category = normalizeMenuCategory(cat.name);
    if (REMOVED_MENU_CATEGORIES.has(category)) continue;
    for (const name of cat.cmds || []) {
      const key = String(name).toLowerCase();
      const entry = commands.get(key);
      const canonical = String(entry?.canonical || aliases.get(key) || key).toLowerCase();
      if (!shared.has(canonical)) shared.set(canonical, category);
    }
  }
  const unique = new Map();
  for (const [name, entry] of commands) {
    if (!entry || typeof entry.handler !== 'function' || entry.disabled || entry.enabled === false) continue;
    const canonical = String(entry.canonical || aliases.get(name) || name).toLowerCase();
    // A deleted canonical must not be advertised by a dangling alias.
    if (!commands.has(canonical)) continue;
    const rawCategory = normalizeMenuCategory(entry.category || shared.get(canonical) || 'MISC');
    const category = REMOVED_MENU_CATEGORIES.has(rawCategory) ? shared.get(canonical) : rawCategory;
    if (!category || REMOVED_MENU_CATEGORIES.has(category)) continue;
    if (!unique.has(canonical) || name === canonical) unique.set(canonical, { name: canonical, category, entry });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function activeMenuCategories(commands, aliases, categories) {
  const entries = canonicalMenuEntries(commands, aliases, categories);
  const grouped = new Map();
  for (const item of entries) {
    if (!grouped.has(item.category)) {
      const previous = categories.find(cat => normalizeMenuCategory(cat.name) === item.category);
      grouped.set(item.category, { ...previous, name: item.category, emoji: previous?.emoji || '📁', cmds: [] });
    }
    grouped.get(item.category).cmds.push(item.name);
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function resolveMenuCategory(args, categories) {
  if (!Array.isArray(args) || !args.length) return null;
  const wanted = normalizeMenuCategory(args.join(' '));
  if (!wanted || REMOVED_MENU_CATEGORIES.has(wanted)) return null;
  const exact = categories.find(cat => cat.name === wanted);
  if (exact) return exact;
  const matches = categories.filter(cat => cat.name.startsWith(wanted));
  return matches.length === 1 ? matches[0] : null;
}
export function formatMenuCategory(cat) {
  return ['╭━━〔 ' + boldCommand(cat.name) + ' · ' + cat.cmds.length + ' 〕━━╮', '', ...cat.cmds.map(name => '± ' + boldCommand(name)), '', '╰━━━━━━━━━━━━━━━━━━╯'].join('\n');
}
export function quoteSection(quote) {
  return '✦ ─────────────────── ✦\n\n\n> 💬 *_"' + quote + '"_*\n\n\n';
}
export function createMenuQuoteSelector(getQuotes, random = Math.random) {
  const previous = new Map();
  return function select(userId = 'global') {
    const key = String(userId || 'global');
    let pool;
    try { pool = [...new Set(getQuotes().filter(q => typeof q === 'string' && q.length))]; } catch { pool = []; }
    if (!pool.length) return 'You are closer than you think. Keep going.';
    const candidates = pool.length > 1 ? pool.filter(q => q !== previous.get(key)) : pool;
    let index = 0;
    try { const n = random(); if (Number.isFinite(n) && n >= 0 && n < 1) index = Math.floor(n * candidates.length); } catch {}
    const quote = candidates[index] || candidates[0];
    if (previous.size >= 2000 && !previous.has(key)) previous.delete(previous.keys().next().value);
    previous.set(key, quote);
    return quote;
  };
}
export const MENU_REACTIONS = Object.freeze({ MAIN: '📋', ALL: '🏷️', DOWNLOAD: '📥', GROUP: '👥', AUDIO: '🎵', TOOLS: '🔧', OWNER: '🔐', SETTINGS: '⚙️', CONFIG: '🎛️', CREATOR: '👑', CONVERT: '🔄', DEBUG: '🐛', STATUS: '🎬', INFO: '📊', MEDIA: '🖼️', MISC: '📁', SEARCH: '🔍', SESSION: '🔑', TTS: '🔊', UTILITY: '🛠️', WHATSAPP: '📱', AI: '🤖', ANIME: '🍥', ADULT: '🔞', HENTAI: '❤️‍🔥', NSFW: '🚨', NEXRAY: '⚡', 'NEXRAY-CANVAS': '🎴' });
const extraReactions = new Map();
export function menuReaction(category) {
  const key = normalizeMenuCategory(category);
  if (REMOVED_MENU_CATEGORIES.has(key)) return null;
  if (MENU_REACTIONS[key]) return MENU_REACTIONS[key];
  if (!extraReactions.has(key)) extraReactions.set(key, String.fromCodePoint(0x1f600 + extraReactions.size % 70));
  return extraReactions.get(key);
}
export function installMenuCategoryPolicy(commands, aliases, categories, legacyNames = []) {
  const shared = new Set();
  const candidates = new Set(legacyNames);
  for (const cat of categories) {
    const removed = REMOVED_MENU_CATEGORIES.has(normalizeMenuCategory(cat.name));
    for (const name of cat.cmds || []) {
      const key = String(name).toLowerCase();
      const canonical = String(commands.get(key)?.canonical || aliases.get(key) || key).toLowerCase();
      (removed ? candidates : shared).add(canonical);
      if (removed) candidates.add(key);
    }
  }
  for (const [name, entry] of commands) {
    if (REMOVED_MENU_CATEGORIES.has(normalizeMenuCategory(entry?.category))) {
      candidates.add(name); candidates.add(String(entry?.canonical || aliases.get(name) || name).toLowerCase());
    }
  }
  for (const name of shared) candidates.delete(name);
  const denied = (name, entry) => {
    const key = String(name).toLowerCase();
    const canonical = String(entry?.canonical || aliases.get(key) || key).toLowerCase();
    return !shared.has(canonical) && (candidates.has(key) || candidates.has(canonical) || REMOVED_MENU_CATEGORIES.has(normalizeMenuCategory(entry?.category)));
  };
  const removed = new Set(), ambiguous = new Set();
  function clean() {
    for (const [name, entry] of commands) {
      const canonical = String(entry?.canonical || aliases.get(name) || name).toLowerCase();
      if (denied(name, entry)) { candidates.add(name); candidates.add(canonical); removed.add(canonical); commands.delete(name); aliases.delete(name); }
      else if (shared.has(canonical) && REMOVED_MENU_CATEGORIES.has(normalizeMenuCategory(entry?.category))) ambiguous.add(canonical);
    }
    for (const [alias, canonical] of aliases) if (denied(alias, commands.get(alias)) || candidates.has(canonical) && !shared.has(canonical)) { commands.delete(alias); aliases.delete(alias); }
    categories.splice(0, categories.length, ...categories.filter(cat => !REMOVED_MENU_CATEGORIES.has(normalizeMenuCategory(cat.name))));
    for (const cat of categories) cat.cmds = (cat.cmds || []).filter(name => !denied(name, commands.get(name)));
    return { removed: [...removed].sort(), ambiguous: [...ambiguous].sort() };
  }
  const originalSet = commands.set.bind(commands);
  commands.set = function(name, entry) {
    if (denied(name, entry)) { candidates.add(String(name).toLowerCase()); candidates.add(String(entry?.canonical || name).toLowerCase()); removed.add(String(entry?.canonical || name).toLowerCase()); aliases.delete(name); return commands; }
    return originalSet(name, entry);
  };
  clean();
  return { denied, clean, removed, ambiguous };
}
// Baileys' protobuf caption is unbounded in this library; never infer a
// Cloud API/UI Read more threshold as a limit. Attempt the full caption first.
export function isCaptionLimitError(error) {
  return /(?:caption|text|message).*(?:too long|length limit|exceeds.{0,25}(?:limit|maximum)|maximum length)|(?:too long|length limit).*caption/i.test(String(error?.message || error));
}
export function splitMenuText(text, limit) {
  const chunks = []; let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    else cut += 1;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut -= 1;
    chunks.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}
export async function deliverMenuCaption(sock, msg, text, pictureSources, sendReply, mentions = []) {
  const jid = msg.key.remoteJid;
  for (const source of pictureSources) {
    let image;
    try { image = await source(); } catch { continue; }
    if (!image) continue;
    try { return await sock.sendMessage(jid, { image, caption: text, ...(mentions.length ? { mentions } : {}) }, { quoted: msg }); }
    catch (error) {
      if (!isCaptionLimitError(error)) continue;
      // Only an explicit rejection proves a continuation is necessary. Keep
      // the quote/header in the first image and preserve every character.
      for (const limit of [4096, 2048, 1024]) {
        if (text.length <= limit) continue;
        const chunks = splitMenuText(text, limit);
        try { await sock.sendMessage(jid, { image, caption: chunks[0], ...(mentions.length ? { mentions } : {}) }, { quoted: msg }); }
        catch (retryError) { if (isCaptionLimitError(retryError)) continue; break; }
        for (const chunk of chunks.slice(1)) await sendReply(sock, msg, chunk);
        return;
      }
    }
  }
  return sendReply(sock, msg, text);
}
