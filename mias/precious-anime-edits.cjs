// =========================================================================
//  precious-anime-edits.cjs  ·  PRECIOUS v24 — anime edits engine
// ─────────────────────────────────────────────────────────────────────────
//  Powers commands like .naruto / .jjk / .demonslayer / .aot / .onepiece …
//
//  Behaviour (per the owner's spec):
//   • reacts ☄️ on every request
//   • drops TWO edits per request
//   • an edit is NEVER repeated for the same user (per-user seen list,
//     persisted to edits/_seen.json; auto-resets when a category is drained)
//   • each request rotates across 3 routes so different users get different
//     videos from different places:
//        1) the classified links zip files  (edits/<category>.txt)
//        2) TikTok page videos of the usernames in edits/_usernames.txt
//        3) random public TikTok search (multi-keyword, quality-filtered)
//   • franchise accuracy is enforced by hashtag/caption validation:
//     Naruto (== Boruto, same franchise) never fetches JJK-only edits, etc.
//     Edits whose hashtags combine franchises live in BOTH category files,
//     so both commands may serve them — exactly as requested.
//   • "no low-life videos": page/search routes require real engagement
//     (digg_count ≥ 1000 or play_count ≥ 10000 when stats are returned)
//   • multiple TikTok APIs with fallback (tikwm primary, then alternates)
//
//  BEGINNER-FRIENDLY: to add more links, just paste TikTok URLs (or the
//  tab-separated lines from the zip) into edits/<category>.txt and to add
//  more pages paste usernames (one per line) into edits/_usernames.txt.
//  No restart logic needed beyond a normal bot restart.
// =========================================================================
'use strict';

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

// ── locate the edits/ folder (repo root) ─────────────────────────────────
function editsDir() {
  const a = path.join(__dirname, '..', 'edits');
  if (fs.existsSync(a)) return a;
  const b = path.join(__dirname, 'edits');
  return fs.existsSync(b) ? b : a;
}

// ── category table: file → franchise tags + command aliases ──────────────
// NOTE: Naruto and Boruto are ONE franchise on purpose (same file, same cmd
// family). JJK + jujutsu_kaisen files are merged. Mixed-hashtag edits are
// already cross-listed inside both franchise files by the zip author.
const CATEGORIES = {
  naruto:        { files: ['naruto_boruto.txt'],                    label: 'Naruto/Boruto',
                   aliases: ['naruto','boruto'],
                   tags: ['naruto','boruto','sasuke','uchiha','itachi','kakashi','sakura','hinata','konoha','hokage','kurama','kyuubi','jiraiya','tsunade','orochimaru','akatsuki','obito','madara','minato','kushina','gaara','rocklee','neji','shikamaru','kawaki','sarada','mitsuki','momoshiki','otsutsuki','uzumaki','uzuhiko','baryonmode','narutoshippuden','narutoshipuden','narutoedit','narutoedits','borutoedit','borutonarutonextgeneration','borutotwobluevortex','sharingan','rinnegan','rasengan','chidori','susanoo','kage'] },
  jjk:           { files: ['jjk.txt','jujutsu_kaisen.txt'],         label: 'Jujutsu Kaisen',
                   aliases: ['jjk','jujutsukaisen','jujutsu'],
                   tags: ['jjk','jujutsu','jujutsukaisen','gojo','satoru','sukuna','ryomen','yuji','itadori','megumi','fushiguro','nobara','kugisaki','nanami','toji','maki','toge','inumaki','geto','suguru','kenjaku','mahito','choso','yuta','okkotsu','hakari','kashimo','shibuya','hollowpurple','domainexpansion','jjkedit','jjkedits'] },
  demonslayer:   { files: ['demon_slayer.txt'],                     label: 'Demon Slayer',
                   aliases: ['demonslayer','ds','kny','kimetsunoyaiba'],
                   tags: ['demonslayer','kimetsunoyaiba','kny','tanjiro','nezuko','zenitsu','inosuke','rengoku','giyu','shinobu','tengen','muichiro','mitsuri','obanai','sanemi','gyomei','akaza','douma','kokushibo','muzan','hashira'] },
  aot:           { files: ['attack_on_titan.txt'],                  label: 'Attack on Titan',
                   aliases: ['aot','attackontitan','shingeki','snk'],
                   tags: ['aot','attackontitan','shingeki','snk','eren','yeager','mikasa','levi','ackerman','armin','erwin','reiner','annie','zeke','hange','titan','rumbling','survey','scouts'] },
  onepiece:      { files: ['one_piece.txt'],                        label: 'One Piece',
                   aliases: ['onepiece','op'],
                   tags: ['onepiece','luffy','zoro','sanji','nami','usopp','chopper','robin','franky','brook','jinbei','shanks','kaido','bigmom','whitebeard','ace','sabo','law','doflamingo','gear5','strawhat','onepieceedit','onepieceedits'] },
  dragonball:    { files: ['dragon_ball.txt'],                      label: 'Dragon Ball',
                   aliases: ['dragonball','db','dbz','dbs'],
                   tags: ['dragonball','dbz','dbs','goku','vegeta','gohan','piccolo','trunks','frieza','cell','broly','beerus','whis','jiren','gogeta','vegito','supersaiyan','ssj','ultrainstinct','kamehameha'] },
  bleach:        { files: ['bleach.txt'],                           label: 'Bleach',
                   aliases: ['bleach'],
                   tags: ['bleach','ichigo','rukia','byakuya','renji','aizen','ulquiorra','grimmjow','kenpachi','toshiro','hitsugaya','uryu','orihime','yoruichi','urahara','shinigami','hollow','espada','bankai','tybw'] },
  blackclover:   { files: ['black_clover.txt'],                     label: 'Black Clover',
                   aliases: ['blackclover','bc'],
                   tags: ['blackclover','asta','yuno','noelle','yami','mereoleona','fuegoleon','licht','zagred','lucifero','antimagic','grimoire'] },
  mha:           { files: ['my_hero_academia.txt'],                 label: 'My Hero Academia',
                   aliases: ['mha','myheroacademia','bnha','bokunohero'],
                   tags: ['mha','myheroacademia','bnha','deku','midoriya','bakugo','todoroki','uraraka','kirishima','allmight','shigaraki','dabi','toga','aizawa','hawks','endeavor','mirko','oneforall'] },
  mushokutensei: { files: ['mushoku_tensei.txt'],                   label: 'Mushoku Tensei',
                   aliases: ['mushokutensei','mt'],
                   tags: ['mushokutensei','mushoku','rudeus','roxy','sylphiette','sylphy','eris','greyrat','ruijerd','orsted','hitogami'] },
  sololeveling:  { files: ['solo_leveling.txt'],                    label: 'Solo Leveling',
                   aliases: ['sololeveling','sl'],
                   tags: ['sololeveling','sungjinwoo','jinwoo','shadowmonarch','igris','beru','ashborn','chahaein'] },
  cote:          { files: ['classroom_of_the_elite.txt'],           label: 'Classroom of the Elite',
                   aliases: ['cote','classroomoftheelite'],
                   tags: ['classroomoftheelite','cote','ayanokoji','kiyotaka','horikita','suzune','kushida','ichinose','sakayanagi','ryuen','karuizawa'] },
  tomodachigame: { files: ['tomodachi_game.txt'],                   label: 'Tomodachi Game',
                   aliases: ['tomodachigame','tomodachi'],
                   tags: ['tomodachigame','tomodachi','yuuichi','katagiri'] },
  horimiya:      { files: ['horimiya.txt'],                         label: 'Horimiya',
                   aliases: ['horimiya'],
                   tags: ['horimiya','hori','miyamura'] },
  oshinoko:      { files: ['oshi_no_ko.txt'],                       label: 'Oshi no Ko',
                   aliases: ['oshinoko','onk'],
                   tags: ['oshinoko','aihoshino','aqua','ruby','kana','arima','akane','memcho'] },
  rezero:        { files: ['re_zero.txt'],                          label: 'Re:Zero',
                   aliases: ['rezero','rz'],
                   tags: ['rezero','re:zero','subaru','emilia','rem','ram','beatrice','roswaal','echidna'] },
  vinlandsaga:   { files: ['vinland_saga.txt'],                     label: 'Vinland Saga',
                   aliases: ['vinlandsaga','vinland'],
                   tags: ['vinlandsaga','vinland','thorfinn','askeladd','canute','thorkell'] },
  spiderman:     { files: ['marvel_spiderman.txt'],                 label: 'Marvel/Spider-Man',
                   aliases: ['spiderman','marvel','avengers','mcu'],
                   tags: ['spiderman','marvel','avengers','peterparker','milesmorales','gwen','tobey','tomholland','venom','mcu','ironman','captainamerica','thor','hulk','thanos','loki','deadpool','wolverine'] },
  invincible:    { files: ['invincible.txt'],                       label: 'Invincible',
                   aliases: ['invincible'],
                   tags: ['invincible','omniman','markgrayson','viltrumite','atomeve'] },
  bluelock:      { files: ['blue_lock.txt'],                        label: 'Blue Lock',
                   aliases: ['bluelock','bllk'],
                   tags: ['bluelock','bllk','isagi','bachira','chigiri','kunigami','nagi','reo','barou','rin','itoshi','sae','shidou','karasu','otoya','yukimiya','ego'] },
  onepunchman:   { files: ['one_punch_man.txt'],                    label: 'One Punch Man',
                   aliases: ['onepunchman','opm'],
                   tags: ['onepunchman','opm','saitama','genos','garou','tatsumaki','fubuki','boros','metalbat'] },
  sonic:         { files: ['sonic.txt'],                            label: 'Sonic',
                   aliases: ['sonic'],
                   tags: ['sonic','sonicthehedgehog','shadowthehedgehog','tails','knuckles','eggman'] },
  fireforce:     { files: ['fire_force.txt'],                       label: 'Fire Force',
                   aliases: ['fireforce','ff'],
                   tags: ['fireforce','shinra','arthur','benimaru','joker','tamaki','shinrabanshoman'] },
};

// ── tiny fs helpers ───────────────────────────────────────────────────────
function seenPath() { return path.join(editsDir(), '_seen.json'); }
function loadSeen() { try { return JSON.parse(fs.readFileSync(seenPath(), 'utf8')); } catch { return {}; } }
function saveSeen(s) { try { fs.writeFileSync(seenPath(), JSON.stringify(s)); } catch {} }

const _cache = new Map(); // file -> {mtime, items}
function loadLinkFile(file) {
  const p = path.join(editsDir(), file);
  let mt = 0;
  try { mt = fs.statSync(p).mtimeMs; } catch { return []; }
  const hit = _cache.get(p);
  if (hit && hit.mtime === mt) return hit.items;
  let items = [];
  try {
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line || !line.includes('tiktok.com')) continue;
      const url = (line.match(/https?:\/\/[^\s]*tiktok\.com[^\s]*/i) || [])[0];
      if (!url) continue;
      const cols = line.split('\t');
      const caption  = cols.length >= 6 ? (cols[3] || '') : '';
      const hashtags = cols.length >= 6 ? (cols[4] || '') : '';
      items.push({ url: url.trim(), caption, hashtags });
    }
  } catch {}
  _cache.set(p, { mtime: mt, items });
  return items;
}
function loadUsernames() {
  const p = path.join(editsDir(), '_usernames.txt');
  try {
    return fs.readFileSync(p, 'utf8').split(/\r?\n/)
      .map(s => s.trim().replace(/^@/, '')).filter(s => s && !s.startsWith('#'));
  } catch { return []; }
}

// ── http helpers ─────────────────────────────────────────────────────────
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
async function getJson(url, timeout = 15000) {
  const r = await axios.get(url, { headers: UA, timeout, validateStatus: () => true });
  if (r.status >= 400 || !r.data) return null;
  return typeof r.data === 'string' ? (() => { try { return JSON.parse(r.data); } catch { return null; } })() : r.data;
}
async function getBuf(url, timeout = 90000) {
  const r = await axios.get(url, { headers: { ...UA, Referer: 'https://www.tiktok.com/' }, responseType: 'arraybuffer', timeout, maxContentLength: 400 * 1024 * 1024, validateStatus: () => true });
  if (r.status >= 400) return null;
  const b = Buffer.from(r.data || []);
  return b.length ? b : null;
}

// ── TikTok info resolvers (multi-API with fallback) ──────────────────────
async function tikwmInfo(videoUrl) {
  const d = await getJson('https://www.tikwm.com/api/?url=' + encodeURIComponent(videoUrl) + '&hd=1');
  const v = d && d.data;
  if (!v || !v.play) return null;
  const host = 'https://www.tikwm.com';
  const abs = u => (u && u.startsWith('/') ? host + u : u);
  return {
    title: v.title || 'TikTok edit',
    author: (v.author && (v.author.unique_id || v.author.nickname)) || '',
    play: abs(v.play), hd: abs(v.hdplay || v.play), music: abs(v.music),
    cover: abs(v.cover || v.origin_cover), digg: v.digg_count || 0, plays: v.play_count || 0,
  };
}
async function resolveTikTok(videoUrl) {
  try { const i = await tikwmInfo(videoUrl); if (i) return i; } catch {}
  try {
    const d = await getJson('https://api.giftedtech.co.ke/api/download/tiktok?apikey=gifted&url=' + encodeURIComponent(videoUrl));
    const r = d && (d.result || d.data);
    const v = r && (r.video || r.nowm || r.no_watermark);
    if (v) return { title: r.title || 'TikTok edit', author: '', play: v, hd: r.hd || v, music: r.music || r.audio, cover: r.cover || r.thumbnail, digg: 0, plays: 0 };
  } catch {}
  return null;
}
async function tikwmUserPosts(uniqueId) {
  const d = await getJson('https://www.tikwm.com/api/user/posts?unique_id=' + encodeURIComponent(uniqueId) + '&count=35&hd=1', 20000);
  const arr = d && d.data && d.data.videos;
  return Array.isArray(arr) ? arr : [];
}
async function tikwmSearch(keywords) {
  const d = await getJson('https://www.tikwm.com/api/feed/search?keywords=' + encodeURIComponent(keywords) + '&count=20&hd=1', 20000);
  const arr = d && d.data && d.data.videos;
  return Array.isArray(arr) ? arr : [];
}

// ── franchise validation ─────────────────────────────────────────────────
function textOf(item) {
  return String((item.caption || '') + ' ' + (item.hashtags || '') + ' ' + (item.title || '')).toLowerCase().replace(/[#_\-]/g, '');
}
function matchesCat(item, cat) {
  const t = textOf(item);
  return cat.tags.some(tag => t.includes(tag.replace(/[#_\-]/g, '')));
}
function qualityOk(v) {
  const digg = Number(v.digg_count || v.digg || 0);
  const plays = Number(v.play_count || v.plays || 0);
  if (!digg && !plays) return true;               // no stats → don't judge
  return digg >= 1000 || plays >= 10000;          // no low-life videos
}

// ── routes ────────────────────────────────────────────────────────────────
function routeZip(cat) {
  const out = [];
  for (const f of cat.files) out.push(...loadLinkFile(f));
  return out.filter(i => matchesCat(i, cat)); // zip is pre-classified; belt+braces
}
async function routePages(cat) {
  const users = loadUsernames();
  if (!users.length) return [];
  const start = Math.floor(Math.random() * users.length);
  for (let k = 0; k < Math.min(4, users.length); k++) {
    const u = users[(start + k) % users.length];
    try {
      const vids = await tikwmUserPosts(u);
      const ok = vids.filter(v => qualityOk(v)).map(v => ({
        url: 'https://www.tiktok.com/@' + u + '/video/' + (v.video_id || v.id),
        caption: v.title || '', hashtags: '',
      })).filter(i => i.url.includes('/video/') && matchesCat(i, cat));
      if (ok.length) return ok;
    } catch {}
  }
  return [];
}
async function routeSearch(cat) {
  const words = cat.aliases.filter(a => a.length > 2);
  const kw = words[Math.floor(Math.random() * words.length)] + ' edit';
  try {
    const vids = await tikwmSearch(kw);
    return vids.filter(v => qualityOk(v)).map(v => ({
      url: 'https://www.tiktok.com/@' + ((v.author && v.author.unique_id) || 'tiktok') + '/video/' + (v.video_id || v.id),
      caption: v.title || '', hashtags: '',
    })).filter(i => i.url.includes('/video/') && matchesCat(i, cat));
  } catch { return []; }
}

// ── per-user unseen picker ───────────────────────────────────────────────
function pickUnseen(userJid, catKey, pool, n) {
  const seen = loadSeen();
  const mine = new Set(((seen[userJid] || {})[catKey]) || []);
  let fresh = pool.filter(i => !mine.has(i.url));
  if (!fresh.length && pool.length) {           // drained → reset this user+cat
    seen[userJid] = seen[userJid] || {}; seen[userJid][catKey] = [];
    saveSeen(seen); fresh = pool.slice();
  }
  // shuffle
  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }
  return fresh.slice(0, n);
}
function markSeen(userJid, catKey, urls) {
  const seen = loadSeen();
  seen[userJid] = seen[userJid] || {};
  const cur = new Set(seen[userJid][catKey] || []);
  for (const u of urls) cur.add(u);
  seen[userJid][catKey] = [...cur].slice(-500);
  saveSeen(seen);
}

// ── route rotation: each request walks routes in a shifted order ─────────
const _rr = new Map(); // userJid -> counter
function routeOrder(userJid) {
  const c = (_rr.get(userJid) || 0);
  _rr.set(userJid, c + 1);
  const base = ['zip', 'pages', 'search'];
  return base.slice(c % 3).concat(base.slice(0, c % 3));
}

// ── install ───────────────────────────────────────────────────────────────
module.exports = {
  install(P, helpers) {
    const { sendVideoRobust, isRealMedia } = helpers;

    async function runEditCmd(catKey, sock, msg) {
      const jid = msg.key.remoteJid;
      const user = (msg.key.participant || msg.key.remoteJid || '').split(':')[0];
      const cat = CATEGORIES[catKey];
      await P.react(sock, msg, '☄️').catch(() => {});
      const sent = [];
      const order = routeOrder(user);
      let pool = [];
      for (const r of order) {
        if (r === 'zip')    pool.push(...routeZip(cat));
        if (r === 'pages')  { try { pool.push(...await routePages(cat)); } catch {} }
        if (r === 'search') { try { pool.push(...await routeSearch(cat)); } catch {} }
        if (pool.length >= 2) break;      // first working route wins, order rotates
      }
      if (!pool.length) {
        await P.react(sock, msg, '❌').catch(() => {});
        return P.sendReply(sock, msg, `❌ No ${cat.label} edits available right now. Try again in a bit.`);
      }
      const picks = pickUnseen(user, catKey, pool, 8); // try up to 8, deliver 2
      for (const item of picks) {
        if (sent.length >= 2) break;
        try {
          const info = await resolveTikTok(item.url);
          if (!info || !info.play) continue;
          const buf = await getBuf(info.hd || info.play);
          if (!buf || !isRealMedia(buf)) continue;
          // V25-OK: title-only caption
          // Requested: the delivered edit shows JUST the title — no
          // "☄️ *… edit*", no 👤 @author line, no 🔗 URL.
          const caption = String(info.title || item.title || (cat.label + ' edit'))
            .replace(/\s+/g, ' ').trim().slice(0, 120) || (cat.label + ' edit');
          await sendVideoRobust(sock, jid, buf, caption, msg);
          sent.push(item.url);
        } catch { /* next candidate */ }
      }
      if (sent.length) {
        markSeen(user, catKey, sent);
        await P.react(sock, msg, '✅').catch(() => {});
        if (sent.length < 2) await P.sendReply(sock, msg, '⚠️ Only one edit could be delivered this time (some sources were down).');
      } else {
        await P.react(sock, msg, '❌').catch(() => {});
        await P.sendReply(sock, msg, `❌ TikTok download APIs are busy right now — try again in a moment.`);
      }
    }

    const registered = [];
    for (const [key, cat] of Object.entries(CATEGORIES)) {
      if (!cat.files.some(f => { try { return fs.statSync(path.join(editsDir(), f)).size > 0; } catch { return false; } })
          && !['naruto','jjk'].includes(key)) {
        // still register — page/search routes may serve it even without zip links
      }
      try {
        P.cmd(cat.aliases, { desc: `Random ${cat.label} TikTok edits (2 per request)`, category: 'STATUS' },
          async (sock, msg) => runEditCmd(key, sock, msg));
        registered.push(cat.aliases[0]);
      } catch (e) { console.log('[anime-edits] register failed for', key, e && e.message); }
    }
    return { categories: registered.length, commands: registered };
  },
};
