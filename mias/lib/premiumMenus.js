// Node-hosted menu helpers. No sockets, sessions, timers or startup side effects.
export const REMOVED_MENU_CATEGORIES = new Set(['GAMES', 'TEXTMAKER', 'STALK', 'LOGO', 'FUN']);
// Presentation-only labels; API/command metadata and handlers stay untouched.
const LEGACY_LABELS = {
  GENERAL: 'INFO', MENU: 'INFO', AI: 'INTELLIGENCE', ANIME: 'ANIMATION',
  'NEXRAY-AI': 'INTELLIGENCE', 'NEXRAY-ANIME': 'ANIMATION',
  'NEXRAY-CANVAS': 'MEDIA', 'NEXRAY-DOWNLOADER': 'DOWNLOAD',
  'NEXRAY-EDITOR': 'MEDIA', 'NEXRAY-EPHOTO': 'LOGO',
  'NEXRAY-FUN': 'FUN', 'NEXRAY-GAMES': 'GAMES', 'NEXRAY-INFO': 'INFO',
  'NEXRAY-MAKER': 'TEXTMAKER', 'NEXRAY-NEWS': 'SEARCH',
  'NEXRAY-PAYMENT': 'INFO', 'NEXRAY-PRIMBON': 'MISC',
  'NEXRAY-RANDOM': 'MISC', 'NEXRAY-SEARCH': 'SEARCH',
  'NEXRAY-STALKER': 'STALK', 'NEXRAY-TEXTPRO': 'TEXTMAKER',
  'NEXRAY-TOOLS': 'TOOLS', 'NEXRAY-UPLOADER': 'TOOLS',
};
export const ORIGINAL_PHASE1_QUOTES = Object.freeze([
  'Ambition becomes a future when you give it a place in your daily routine.',
  'A life lesson is useful only when your next choice remembers it.',
  'Growth is the quiet agreement to stop defending the habits that hold you back.',
  'Discipline keeps building after excitement has left the room.',
  'Patience is not standing still; it is giving honest work time to take root.',
  'Betrayal reveals a boundary you are allowed to rebuild more carefully.',
  'Cheating is a choice someone made, not a verdict on your worth.',
  'Trust grows where small promises are kept without an audience.',
  'Self-respect means you do not have to abandon yourself to keep somebody close.',
  'Independence is learning to carry your future without closing your heart.',
  'A healthy relationship leaves room for two people to keep becoming themselves.',
  'Build a better future with decisions your tired tomorrow will thank you for.',
  'Let your ambition make you consistent before it makes you visible.',
  'A lesson learned gently is still worth keeping when life becomes loud.',
  'You can outgrow a chapter without pretending it never mattered.',
  'The smallest promise you keep to yourself can become the strongest foundation.',
  'Waiting wisely means preparing for the door, not staring at it.',
  'After betrayal, choose discernment rather than a lifetime of suspicion.',
  'Loyalty is not a speech about love; it is what happens when love is unobserved.',
  'Rebuilding trust needs changed patterns, not more polished apologies.',
  'Your peace does not need a courtroom before you are allowed to protect it.',
  'Standing on your own feet does not mean refusing a helping hand.',
  'Choose relationships where honesty does not have to compete with comfort.',
  'The future improves every time you finish one useful thing today.',
]);
const CATEGORY_ALIASES = { GAME: 'GAMES', STALKER: 'STALK', GROUPS: 'GROUP', DOWNLOADS: 'DOWNLOAD', DL: 'DOWNLOAD', MAIN: 'INFO', SYSTEM: 'INFO', SETTING: 'SETTINGS' };
export function normalizeMenuCategory(value) {
  const key = String(value || '').trim().toUpperCase().replace(/^CAT_/, '');
  return LEGACY_LABELS[key] || CATEGORY_ALIASES[key] || key;
}
export function boldCommand(value) {
  // WhatsApp's supported bold markup, not a claim of custom fonts/colours.
  return '*' + String(value || '').toUpperCase().replace(/[*_~`\r\n]/g, '') + '*';
}
export function isMenuEntryVisible(name, entry, context = {}) {
  if (!entry || typeof entry.handler !== 'function' || entry.disabled || entry.enabled === false || entry.hidden || entry.internal || /^Internal\b/i.test(entry.desc || '')) return false;
  if (context.owner === undefined) return true; // registry-wide audits, not a user response
  if (entry.creatorOnly && !context.creator) return false;
  // Existing v38 wrappers guard settings/customization even where ownerOnly
  // metadata is absent. Mirror that visibility rule without touching guards.
  if (entry.__v38OwnerGuard && !(context.guardOwner ?? context.owner)) {
    const adminSurface = context.group && context.admin && context.publicMode && !['sudo', 'setsudo'].includes(name);
    if (!adminSurface) return false;
  }
  if (entry.groupOnly && !context.group) return false;
  const adminAllowed = context.admin && entry.category === 'GROUP' && !['hijack', 'takegroup', 'stealgroup'].includes(name);
  if (entry.ownerOnly && !context.owner && !adminAllowed) return false;
  if (entry.adminOnly && context.group && !context.owner && !context.admin) return false;
  if (!context.owner && context.banned?.has(name)) return false;
  if (context.safeMode && context.risky?.has(name)) return false;
  return true;
}
export function canonicalMenuEntries(commands, aliases = new Map(), categories = [], context = {}) {
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
    if (!isMenuEntryVisible(name, entry, context)) continue;
    const canonical = String(entry.canonical || aliases.get(name) || name).toLowerCase();
    // A deleted canonical must not be advertised by a dangling alias.
    const primary = commands.get(canonical);
    if (!isMenuEntryVisible(canonical, primary, context)) continue;
    const rawCategory = normalizeMenuCategory(primary.category || shared.get(canonical) || 'MISC');
    const category = REMOVED_MENU_CATEGORIES.has(rawCategory) ? shared.get(canonical) : rawCategory;
    if (!category || REMOVED_MENU_CATEGORIES.has(category)) continue;
    const definition = categories.find(cat => normalizeMenuCategory(cat.name) === category);
    if ((definition?.adult || ['ADULT', 'HENTAI', 'NSFW'].includes(category)) && context.owner !== undefined && (!context.adultMode || context.safeMode)) continue;
    if (!unique.has(canonical) || name === canonical) unique.set(canonical, { name: canonical, category, entry: primary });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function activeMenuCategories(commands, aliases, categories, context = {}) {
  const entries = canonicalMenuEntries(commands, aliases, categories, context);
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
  const raw = args.join(' ').trim().toUpperCase().replace(/^CAT_/, '');
  if (Object.hasOwn(LEGACY_LABELS, raw)) return null;
  const wanted = normalizeMenuCategory(raw);
  if (!wanted || REMOVED_MENU_CATEGORIES.has(wanted)) return null;
  const exact = categories.find(cat => cat.name === wanted);
  if (exact) return exact;
  const matches = categories.filter(cat => cat.name.startsWith(wanted));
  return matches.length === 1 ? matches[0] : null;
}
export function formatMenuCategory(cat) {
  return ['╭━〔 🟨 ' + boldCommand(cat.name) + ' · ' + cat.cmds.length + ' 〕━━╮', '', ...cat.cmds.map(name => '± ' + boldCommand(name)), '', '╰━━━━━━━━━━━━━━━━━━╯'].join('\n');
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
export const MENU_REACTIONS = Object.freeze({ MAIN: '📋', ALL: '🏷️', INTELLIGENCE: '🤖', ANIMATION: '🍥', DOWNLOAD: '📥', GROUP: '👥', AUDIO: '🎵', TOOLS: '🔧', OWNER: '🔐', SETTINGS: '⚙️', CONFIG: '🎛️', CREATOR: '👑', CONVERT: '🔄', DEBUG: '🐛', STATUS: '🎬', INFO: '📊', MEDIA: '🖼️', MISC: '📁', SEARCH: '🔍', SESSION: '🔑', TTS: '🔊', UTILITY: '🛠️', WHATSAPP: '📱', AI: '🤖', ANIME: '🍥', ADULT: '🔞', HENTAI: '❤️‍🔥', NSFW: '🚨', NEXRAY: '⚡', 'NEXRAY-CANVAS': '🎴' });
const extraReactions = new Map();
export function menuReaction(category) {
  const raw = String(category || '').toUpperCase();
  const key = ['MAIN', 'ALL'].includes(raw) ? raw : normalizeMenuCategory(category);
  if (REMOVED_MENU_CATEGORIES.has(key)) return null;
  if (MENU_REACTIONS[key]) return MENU_REACTIONS[key];
  if (!extraReactions.has(key)) extraReactions.set(key, String.fromCodePoint(0x1f600 + extraReactions.size % 70));
  return extraReactions.get(key);
}
export function installMenuCategoryPolicy(commands, aliases, categories, legacyNames = []) {
  // Keep the pre-existing dispatcher policy unchanged. Renaming a legacy
  // presentation label must NEVER newly disable its command implementations.
  const policyCategory = value => {
    const key = String(value || '').trim().toUpperCase().replace(/^CAT_/, '');
    return CATEGORY_ALIASES[key] || key;
  };
  const shared = new Set();
  const candidates = new Set(legacyNames);
  for (const cat of categories) {
    const removed = REMOVED_MENU_CATEGORIES.has(policyCategory(cat.name));
    for (const name of cat.cmds || []) {
      const key = String(name).toLowerCase();
      const canonical = String(commands.get(key)?.canonical || aliases.get(key) || key).toLowerCase();
      (removed ? candidates : shared).add(canonical);
      if (removed) candidates.add(key);
    }
  }
  for (const [name, entry] of commands) {
    if (REMOVED_MENU_CATEGORIES.has(policyCategory(entry?.category))) {
      candidates.add(name); candidates.add(String(entry?.canonical || aliases.get(name) || name).toLowerCase());
    }
  }
  for (const name of shared) candidates.delete(name);
  const denied = (name, entry) => {
    const key = String(name).toLowerCase();
    const canonical = String(entry?.canonical || aliases.get(key) || key).toLowerCase();
    return !shared.has(canonical) && (candidates.has(key) || candidates.has(canonical) || REMOVED_MENU_CATEGORIES.has(policyCategory(entry?.category)));
  };
  const removed = new Set(), ambiguous = new Set();
  function clean() {
    for (const [name, entry] of commands) {
      const canonical = String(entry?.canonical || aliases.get(name) || name).toLowerCase();
      if (denied(name, entry)) { candidates.add(name); candidates.add(canonical); removed.add(canonical); commands.delete(name); aliases.delete(name); }
      else if (shared.has(canonical) && REMOVED_MENU_CATEGORIES.has(policyCategory(entry?.category))) ambiguous.add(canonical);
    }
    for (const [alias, canonical] of aliases) if (denied(alias, commands.get(alias)) || candidates.has(canonical) && !shared.has(canonical)) { commands.delete(alias); aliases.delete(alias); }
    categories.splice(0, categories.length, ...categories.filter(cat => !REMOVED_MENU_CATEGORIES.has(policyCategory(cat.name))));
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
// Classify explicit delivery rejections separately from unavailable pictures.
export function isCaptionLimitError(error) {
  return /(?:caption|text|message).*(?:too long|length limit|exceeds.{0,25}(?:limit|maximum)|maximum length)|(?:too long|length limit).*caption/i.test(String(error?.message || error));
}
export function splitMenuText(text, limit) {
  if (!Number.isInteger(limit) || limit < 2) throw new RangeError('Menu chunk limit must be an integer >= 2');
  const chunks = []; let rest = String(text || '');
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit - 1);
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
  // Conservative delivery budget, not an assertion about every WhatsApp client.
  // Ordinary menus stay in one caption; oversized output is bounded BEFORE send.
  const safeChunks = splitMenuText(text, 16000);
  const caption = safeChunks[0] || '';
  const sendText = async value => {
    for (const chunk of splitMenuText(value, 4000)) await sendReply(sock, msg, chunk);
  };
  const finish = async () => { for (const chunk of safeChunks.slice(1)) await sendText(chunk); };
  for (const source of pictureSources) {
    let image;
    try { image = await source(); } catch { continue; }
    if (!image) continue;
    try { await sock.sendMessage(jid, { image, caption, ...(mentions.length ? { mentions } : {}) }, { quoted: msg }); }
    catch (error) {
      if (!isCaptionLimitError(error)) continue;
      // Only an explicit rejection proves a continuation is necessary. Keep
      // the quote/header in the first image and preserve every character.
      for (const limit of [4096, 2048, 1024]) {
        if (caption.length <= limit) continue;
        const chunks = splitMenuText(caption, limit);
        try { await sock.sendMessage(jid, { image, caption: chunks[0], ...(mentions.length ? { mentions } : {}) }, { quoted: msg }); }
        catch (retryError) { if (isCaptionLimitError(retryError)) continue; break; }
        for (const chunk of chunks.slice(1)) await sendText(chunk);
        await finish();
        return;
      }
      continue;
    }
    await finish();
    return;
  }
  return sendText(text);
}
