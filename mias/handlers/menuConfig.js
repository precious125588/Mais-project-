/**
 * MIAS — Menu Configuration  v2
 *
 * Single source of truth for all bot menu categories and their commands.
 * menuHandler.js and uiHandler.js read from here.
 *
 * To add a new category or command:
 *   1. Add an entry to MENU_CATEGORIES below.
 *   2. No other menu code needs to change.
 *
 * Architecture:  menuConfig.js → menuHandler, uiHandler
 */

// ─── Category definitions ─────────────────────────────────────────────────────

/**
 * @typedef {object} MenuCommand
 * @property {string}  name   - Command name (without prefix)
 * @property {string}  desc   - Short description (≤60 chars)
 * @property {boolean} [wizard] - true if command needs wizard input
 */

/**
 * @typedef {object} MenuCategory
 * @property {string}        id    - Unique category ID (used in button payloads)
 * @property {string}        label - Human-readable label
 * @property {MenuCommand[]} cmds  - Commands in this category
 */

/** @type {MenuCategory[]} */
export const MENU_CATEGORIES = [
  {
    id: "cat_system",
    label: "⚙️ System",
    cmds: [
      { name: "ping",      desc: "Bot latency check",              wizard: false },
      { name: "uptime",    desc: "Bot uptime",                     wizard: false },
      { name: "info",      desc: "Bot information",                wizard: false },
      { name: "runtime",   desc: "Runtime resource usage",         wizard: false },
      { name: "speed",     desc: "Internet speed test",            wizard: false },
      { name: "myip",      desc: "Bot's public IP address",        wizard: false },
      { name: "alive",     desc: "Check if bot is alive",          wizard: false },
      { name: "menu",      desc: "Open the full bot menu",         wizard: false },
      { name: "help",      desc: "Show help for a command",        wizard: true  },
    ],
  },
  {
    id: "cat_dl",
    label: "⬇️ Downloads",
    cmds: [
      { name: "play",       desc: "Play / download a song",        wizard: true },
      { name: "song",       desc: "Download song as audio",        wizard: true },
      { name: "video",      desc: "Download a YouTube video",      wizard: true },
      { name: "ytmp3",      desc: "YouTube → MP3 audio",           wizard: true },
      { name: "ytmp4",      desc: "YouTube → MP4 video",           wizard: true },
      { name: "spotify",    desc: "Download Spotify track",        wizard: true },
      { name: "facebook",   desc: "Facebook video downloader",     wizard: true },
      { name: "instagram",  desc: "Instagram downloader",          wizard: true },
      { name: "tiktok",     desc: "TikTok video downloader",       wizard: true },
      { name: "pinterest",  desc: "Pinterest image search",        wizard: true },
      { name: "mediafire",  desc: "MediaFire downloader",          wizard: true },
      { name: "soundcloud", desc: "SoundCloud downloader",         wizard: true },
      { name: "twitter",    desc: "Twitter / X downloader",        wizard: true },
      { name: "xdownload",  desc: "X (Twitter) post downloader",   wizard: true },
      { name: "apk",        desc: "Search and download APK",       wizard: true },
    ],
  },
  {
    id: "cat_ai",
    label: "🤖 AI",
    cmds: [
      { name: "ai",      desc: "AI assistant chat",            wizard: true },
      { name: "gpt",     desc: "ChatGPT conversation",         wizard: true },
      { name: "gpt4",    desc: "GPT-4 conversation",           wizard: true },
      { name: "gpt4o",   desc: "GPT-4o conversation",          wizard: true },
      { name: "mistral", desc: "Mistral AI chat",              wizard: true },
      { name: "deepseek",desc: "DeepSeek AI chat",              wizard: true },
      { name: "gemini",  desc: "Google Gemini AI",             wizard: true },
      { name: "imagine", desc: "AI image generation",          wizard: true },
      { name: "flux",    desc: "Flux image generation",        wizard: true },
      { name: "tts",     desc: "Text to speech",                wizard: true },
    ],
  },
  {
    id: "cat_search",
    label: "🔍 Search",
    cmds: [
      { name: "google",    desc: "Google web search",          wizard: true },
      { name: "youtube",   desc: "YouTube search",             wizard: true },
      { name: "wiki",      desc: "Wikipedia lookup",           wizard: true },
      { name: "wikipedia", desc: "Wikipedia search",           wizard: true },
      { name: "weather",   desc: "Weather for a city",         wizard: true },
      { name: "news",      desc: "Latest news headlines",      wizard: true },
    ],
  },
  {
    id: "cat_media",
    label: "🎨 Media",
    cmds: [
      { name: "sticker",  desc: "Image / video → sticker",    wizard: true },
      { name: "toimg",    desc: "Sticker → image",            wizard: true },
      { name: "toanim",   desc: "Sticker → animated GIF",     wizard: true },
      { name: "togif",    desc: "Video → GIF",                wizard: true },
      { name: "ttp",      desc: "Text → sticker",             wizard: true },
      { name: "attp",     desc: "Text → animated sticker",    wizard: true },
      { name: "remini",   desc: "Enhance photo with Remini",  wizard: true },
      { name: "enhance",  desc: "AI image enhancer",          wizard: true },
      { name: "ocr",      desc: "Extract text from image",    wizard: true },
    ],
  },
  {
    id: "cat_tools",
    label: "🛠️ Tools",
    cmds: [
      { name: "translate", desc: "Translate text to any language", wizard: true },
      { name: "shorten",   desc: "URL shortener",                  wizard: true },
      { name: "qr",        desc: "Generate a QR code",             wizard: true },
      { name: "base64",    desc: "Encode text to Base64",          wizard: true },
      { name: "decode",    desc: "Decode Base64 text",             wizard: true },
      { name: "calc",      desc: "Calculator",                     wizard: true },
      { name: "currency",  desc: "Currency converter",             wizard: true },
      { name: "tts",       desc: "Text to speech",                 wizard: true },
      { name: "font",      desc: "Stylized font generator",        wizard: true },
      { name: "carbon",    desc: "Code screenshot (Carbon)",       wizard: true },
    ],
  },
  {
    id: "cat_groups",
    label: "👥 Groups",
    cmds: [
      { name: "kick",      desc: "Remove a member from group",    wizard: true  },
      { name: "promote",   desc: "Promote member to admin",       wizard: true  },
      { name: "demote",    desc: "Remove member admin role",      wizard: true  },
      { name: "mute",      desc: "Mute the group",                wizard: false },
      { name: "unmute",    desc: "Unmute the group",              wizard: false },
      { name: "link",      desc: "Get group invite link",         wizard: false },
      { name: "revoke",    desc: "Reset group invite link",       wizard: false },
      { name: "setdesc",   desc: "Set group description",         wizard: true  },
      { name: "setname",   desc: "Set group name",                wizard: true  },
      { name: "tagall",    desc: "Mention all group members",     wizard: false },
      { name: "hidetag",   desc: "Silent tag all members",        wizard: true  },
      { name: "antilink",  desc: "Toggle anti-link protection",   wizard: false },
      { name: "antitoxic", desc: "Toggle anti-toxic filter",      wizard: false },
    ],
  },
  {
    id: "cat_status",
    label: "🎬 Status",
    cmds: [
      { name: "naruto",         desc: "Send 2 random Naruto edits",          wizard: false },
      { name: "jjk",            desc: "Send 2 random JJK edits",             wizard: false },
      { name: "demonslayer",    desc: "Send 2 random Demon Slayer edits",   wizard: false },
      { name: "onepiece",       desc: "Send random One Piece edits",         wizard: false },
      { name: "bleach",         desc: "Send random Bleach edits",             wizard: false },
      { name: "dragonball",     desc: "Send random Dragon Ball edits",        wizard: false },
      { name: "attackontitan",  desc: "Send random Attack on Titan edits",    wizard: false },
      { name: "sololeveling",   desc: "Send random Solo Leveling edits",      wizard: false },
      { name: "myheroacademia", desc: "Send random My Hero Academia edits",   wizard: false },
      { name: "onepunchman",    desc: "Send random One Punch Man edits",      wizard: false },
      { name: "blackclover",    desc: "Send random Black Clover edits",       wizard: false },
      { name: "chainsawman",    desc: "Send random Chainsaw Man edits",       wizard: false },
      { name: "tokyorevengers", desc: "Send random Tokyo Revengers edits",    wizard: false },
      { name: "bluelock",       desc: "Send random Blue Lock edits",          wizard: false },
    ],
  },
  {
    id: "cat_whatsapp",
    label: "📱 WhatsApp",
    cmds: [
      { name: "profile",    desc: "View a contact's profile",     wizard: true  },
      { name: "bio",        desc: "Get a contact's bio",          wizard: true  },
      { name: "pp",         desc: "Get a contact's profile pic",  wizard: true  },
      { name: "gst",        desc: "Post a WhatsApp story",        wizard: true  },
      { name: "check",      desc: "Check if number is on WA",     wizard: true  },
      { name: "jid",        desc: "Show JID of a number",         wizard: true  },
      { name: "readstatus", desc: "Mark status as read",          wizard: false },
    ],
  },
  {
    id: "cat_account",
    label: "💰 Account",
    cmds: [
      { name: "premium",  desc: "View premium status",            wizard: false },
      { name: "register", desc: "Register your account",          wizard: false },
      { name: "balance",  desc: "Check your balance",             wizard: false },
      { name: "buy",      desc: "Purchase premium",               wizard: true  },
      { name: "refer",    desc: "Referral system",                wizard: false },
      { name: "limit",    desc: "Check daily usage limit",        wizard: false },
    ],
  },
  {
    id: "cat_games",
    label: "🎮 Games",
    cmds: [
      { name: "tictactoe", desc: "Play Tic-Tac-Toe",             wizard: true  },
      { name: "truth",     desc: "Truth or dare — truth",         wizard: false },
      { name: "dare",      desc: "Truth or dare — dare",          wizard: false },
      { name: "8ball",     desc: "Magic 8-ball",                  wizard: true  },
      { name: "joke",      desc: "Random joke",                   wizard: false },
      { name: "quote",     desc: "Inspirational quote",           wizard: false },
      { name: "riddle",    desc: "Riddle challenge",              wizard: false },
    ],
  },
  {
    id: "cat_owner",
    label: "👑 Owner Tools",
    cmds: [
      { name: "broadcast", desc: "Broadcast message to all chats",  wizard: true  },
      { name: "block",     desc: "Block a user",                    wizard: true  },
      { name: "unblock",   desc: "Unblock a user",                  wizard: true  },
      { name: "ban",       desc: "Ban a user from bot",             wizard: true  },
      { name: "unban",     desc: "Unban a user",                    wizard: true  },
      { name: "setprefix", desc: "Change bot command prefix",       wizard: true  },
      { name: "mode",      desc: "Switch public / private mode",    wizard: true  },
      { name: "restart",   desc: "Restart the bot",                 wizard: false },
      { name: "shutdown",  desc: "Shutdown the bot",                wizard: false },
      { name: "addcmd",    desc: "Add a runtime command",           wizard: true  },
      { name: "getcmd",    desc: "View a saved command source",     wizard: true  },
      { name: "delcmd",    desc: "Delete a runtime command",        wizard: true  },
      { name: "listcmds",  desc: "List all runtime commands",       wizard: false },
      { name: "eval",      desc: "Evaluate code (owner only)",      wizard: true  },
      { name: "exec",      desc: "Run shell command",               wizard: true  },
      { name: "setbio",    desc: "Set bot bio/about",               wizard: true  },
      { name: "setpp",     desc: "Set bot profile picture",         wizard: true  },
      { name: "getvar",    desc: "Get a saved variable",            wizard: true  },
      { name: "setvar",    desc: "Set a saved variable",            wizard: true  },
      { name: "delvar",    desc: "Delete a variable",               wizard: true  },
    ],
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/** Get a category by its id string */
export function getCategoryById(id) {
  return MENU_CATEGORIES.find(c => c.id === id) || null;
}

/** Get a category by its label (case-insensitive) */
export function getCategoryByLabel(label) {
  const lower = (label || "").toLowerCase();
  return MENU_CATEGORIES.find(c => c.label.toLowerCase() === lower) || null;
}

/** Get all commands across all categories as a flat array */
export function getAllCommands() {
  return MENU_CATEGORIES.flatMap(c =>
    c.cmds.map(cmd => ({ ...cmd, category: c.id, categoryLabel: c.label }))
  );
}

/** Find a command by name across all categories */
export function findCommand(name) {
  const lower = (name || "").toLowerCase();
  for (const cat of MENU_CATEGORIES) {
    const cmd = cat.cmds.find(c => c.name === lower);
    if (cmd) return { ...cmd, category: cat.id, categoryLabel: cat.label };
  }
  return null;
}

/** Total command count across all categories */
export function getTotalCommandCount() {
  return MENU_CATEGORIES.reduce((sum, c) => sum + c.cmds.length, 0);
}
