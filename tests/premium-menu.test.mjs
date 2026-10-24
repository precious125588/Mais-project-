import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as menu from '../mias/lib/premiumMenus.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Source extraction avoids importing index.js: its import starts sockets, cache
// cleanup and timers. Parse its actual handler bodies, never a test copy.
const source=fs.readFileSync(path.join(ROOT,'mias/index.js'),'utf8');
function functionSource(name) {
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,name+' exists');
 // These production functions are delimited by the following top-level function/registration.
 const next=source.slice(start+1).search(/\n(?:async function |function |cmd\(|  try \{\n  const cuzMod)/);
 return source.slice(start,start+1+next).trim();
}
function quoteArray(name) {
 const match=source.match(new RegExp('const '+name+' = (\\[[\\s\\S]*?\\n\\]);'));
 assert.ok(match,name+' array exists');return vm.runInNewContext(match[1]);
}
function categoryArray(){const a=source.indexOf('const MENU_CATEGORIES = [');const b=source.indexOf('\n];',a);return vm.runInNewContext(source.slice(a,b+3)+'; MENU_CATEGORIES');}
const quoteNames=['_HOPE_QUOTES','_MENU_QUOTES_EXTRA','_SAD_QUOTES','_TRUTH_QUOTES'];
const quotes=quoteNames.flatMap(quoteArray).concat(JSON.parse(fs.readFileSync(path.join(ROOT,'mias/quotes_massive.json'),'utf8')));
function createHarness({imageFailure=false,reactionFailure=false,sendFailure=false,owner=true,creator=true,group=false,admin=false,adultMode=true,safeMode=false,banned=new Set(),customPicture=null}={}) {
 const commands=new Map(), aliases=new Map(), categories=categoryArray();const settings={adultMode,safeMode,workMode:'private',...(customPicture?{__cuz:{botProfile:customPicture}}:{})};
 const register=(names,opts={},handler=async()=>{})=>{const list=[].concat(names);for(let i=0;i<list.length;i++){const name=list[i].toLowerCase();commands.set(name,{...opts,canonical:list[0],isAlias:i>0,handler});if(i)aliases.set(name,list[0]);}};
 for(const cat of categories)for(const name of cat.cmds)register(name,{category:cat.name});
 register(['tiktok','tt','ttdl'],{category:'DOWNLOAD'});register(['menu','help','commands','.menu','start'],{category:'INFO'});register(['allmenu','fullmenu'],{category:'INFO'});
 register('disabled',{category:'TOOLS',disabled:true});register('inactive',{category:'TOOLS',enabled:false});
 const policy=menu.installMenuCategoryPolicy(commands,aliases,categories,['gitstalk']);
  let profileCalls=0, displayNameCalls=0;
  const sent=[]; const sock={user:{id:'12345:1@s.whatsapp.net'},profilePictureUrl:async jid=>{profileCalls++;assert.equal(jid,'12345@s.whatsapp.net');if(imageFailure)throw Error('profile unavailable');return 'https://example.test/profile.jpg';},sendMessage:async(jid,content,options)=>{sent.push({jid,content,options});if(content.react&&reactionFailure)throw Error('reaction failed');if(content.image&&sendFailure)throw Error('image failed');return{key:{id:'out-'+sent.length}};}};
 const msg={key:{remoteJid:'67890@s.whatsapp.net',id:'incoming-1',fromMe:false},pushName:'Mia'};
  const sandbox={...menu,commands,aliases,MENU_CATEGORIES:categories,CONFIG:{PREFIX:'.',VERSION:'5.3.1',BOT_NAME:'𝑴𝑰𝑨𝑺 𝑴𝑫𝑿'},getSettings:()=>settings,getSender:()=>msg.key.remoteJid,_cleanNum:s=>s.split('@')[0],pushNameCache:new Map(),getDisplayName:async()=>{displayNameCalls++;return msg.pushName;},isOwner:()=>owner,isCreator:()=>creator,isSudo:()=>false,isSudoIn:()=>false,isGroupAdmin:async()=>admin,RISKY_CMDS:new Set(['risk']),settings:new Map([['67890@s.whatsapp.net_banned',banned]]),isGroup:()=>group,process:{uptime:()=>125,memoryUsage:()=>({rss:32*1048576})},fmtUptime:()=> '2m 5s',_randomMenuQuoteForUser:menu.createMenuQuoteSelector(()=>quotes),_LOCAL_BOT_PICS:[path.join(ROOT,'mias/assets/allmenu.jpg')],_BOT_PIC_FALLBACKS:['https://example.test/configured.jpg'],_menuPicCached:()=>null,_menuPicStore:()=>{},fs:{readFileSync:p=>{if(imageFailure)throw Error('local unavailable');return fs.readFileSync(p);}},Buffer,axios:{get:async()=>{if(imageFailure)throw Error('image retrieval failed');return{data:fs.readFileSync(path.join(ROOT,'mias/assets/allmenu.jpg'))};}},react:async(s,m,emoji)=>s.sendMessage(m.key.remoteJid,{react:{text:emoji,key:m.key}}),sendReply:async(s,m,text)=>s.sendMessage(m.key.remoteJid,{text},{quoted:m}),sendMenuSong:async()=>{},Date,Math,Map,Set,String};
 vm.createContext(sandbox);
 const funcs=['getPrimaryCommandCount','getCategoryPrimaryCommands','buildMenuOverview','buildMenu','menuPictureSources','menuVisibilityContext','sendPremiumMenu','cmdMenu','cmdAll'].map(functionSource).join('\n').replace('function sendPremiumMenu(', 'async function sendPremiumMenu(').replace('function menuVisibilityContext(', 'async function menuVisibilityContext(').replace('function cmdMenu(', 'async function cmdMenu(').replace('function cmdAll(', 'async function cmdAll(');
 // functionSource starts at "function" and retains async for inner awaits via prefix.
 vm.runInContext(funcs,sandbox);
 // Execute the actual .menu/.allmenu registrations, not test replacement handlers.
 sandbox.cmd=register;
 for (const command of ['allmenu','menu']) {
   const start=source.indexOf("cmd(['"+command+"'");
   const end=source.indexOf('\n',start);
   vm.runInContext(source.slice(start,end),sandbox);
 }
  return {sock,msg,sent,commands,aliases,categories,policy,sandbox,displayNameCalls:()=>displayNameCalls,profileCalls:()=>profileCalls,run:(args=[],all=false)=>sandbox.sendPremiumMenu(sock,msg,args,all)};
}
function image(h){return h.sent.find(x=>x.content.image)?.content;}
test('actual main and allmenu handlers send one image caption with live stats, footer, quote spacing',async()=>{
 const h=createHarness();await h.run();const main=image(h);assert.ok(main.image);assert.match(main.caption,/^────────────────────\n\s+\*.+\*\n\s+\*M[\u200b]?IAS MDX\*\n────────────────────\n\n/);assert.match(main.caption,/\n\n> _".+"_\n\n/);assert.match(main.caption,/VERSION: 5\.3\.1/);assert.match(main.caption,/MODE: PRIVATE/);assert.match(main.caption,/COMMANDS  →  \d+/);assert.match(main.caption,/𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x$/);assert.equal(h.sent.filter(x=>x.content.react).length,1);assert.equal(h.sent[0].content.react.key,h.msg.key);
 h.sent.length=0;await h.run([],true);const all=image(h);assert.match(all.caption,/\n\n> _".+"_\n\n/);assert.equal(h.sent.filter(x=>x.content.image).length,1);assert.equal(h.sent.filter(x=>x.content.text).length,0);assert.equal(h.sent[0].content.react.text,menu.menuReaction('ALL'));const lines=all.caption.split('\n').filter(l=>l.startsWith('± '));const entries=menu.canonicalMenuEntries(h.commands,h.aliases,h.categories);assert.equal(lines.length,entries.length);assert.equal(new Set(lines).size,lines.length);for(const e of entries)assert.ok(lines.includes('± '+menu.boldCommand(e.name)));assert.ok(!lines.includes('± '+menu.boldCommand('tt')));assert.ok(!lines.includes('± '+menu.boldCommand('disabled')));
});
test('every active category uses its own reaction, picture and ONLY canonical category entries',async()=>{const h=createHarness();for(const cat of menu.activeMenuCategories(h.commands,h.aliases,h.categories)){h.sent.length=0;await h.run([cat.name.toLowerCase()]);assert.equal(h.sent.filter(x=>x.content.react).length,1);assert.equal(h.sent[0].content.react.text,menu.menuReaction(cat.name));const outgoing=image(h);assert.ok(outgoing);const lines=outgoing.caption.split('\n').filter(l=>l.startsWith('± '));assert.deepEqual(lines,cat.cmds.map(n=>'± '+menu.boldCommand(n)));assert.match(outgoing.caption,/\n\n> _"/);assert.equal(h.sent.filter(x=>x.content.image).length,1);}});
test('case-insensitive and unambiguous category aliases; invalid and removed requests do not become main menu',async()=>{const h=createHarness();for(const n of ['download','GROUP','audio','tools','owner','settings','groups','dl']){h.sent.length=0;await h.run([n]);assert.ok(image(h),n);}for(const n of ['not-real','games','game','stalk','stalker','logo','fun','textmaker']){h.sent.length=0;await h.run([n]);assert.equal(image(h),undefined);assert.match(h.sent[0].content.text,/not found/);assert.equal(h.sent.filter(x=>x.content.react).length,0);}});
test('reaction errors do not prevent menu; image lookup/send failures exhaust fallbacks then safe text',async()=>{const r=createHarness({reactionFailure:true});await r.run();assert.ok(image(r));const f=createHarness({imageFailure:true});await f.run();assert.equal(image(f),undefined);assert.ok(f.sent.some(x=>x.content.text?.includes('𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x')));const s=createHarness({sendFailure:true});await s.run([],true);assert.ok(s.sent.some(x=>x.content.text?.includes('± ')));});
test('configured picture failure proceeds directly to the verified local fallback',async()=>{const custom='https://example.test/configured.jpg';const h=createHarness({customPicture:custom});assert.equal(h.sandbox.getSettings('global_cuz')?.__cuz?.botProfile,custom);let count=0;h.sandbox.axios.get=async()=>{count++;throw Error('unavailable')};await h.run();assert.equal(count,1);assert.equal(h.profileCalls(),0);assert.ok(Buffer.isBuffer(image(h).image));assert.deepEqual(image(h).image,fs.readFileSync(path.join(ROOT,'mias/assets/allmenu.jpg')));});
test('main and allmenu skip unused name/profile network lookups when a local cover exists',async()=>{const h=createHarness();let remotePictureCalls=0;h.sandbox.axios.get=async()=>{remotePictureCalls++;throw Error('slow remote image')};await h.run();assert.ok(Buffer.isBuffer(image(h).image));assert.equal(h.displayNameCalls(),0);assert.equal(h.profileCalls(),0);assert.equal(remotePictureCalls,0);});
test('quote selector draws from complete old/new pool and never repeats at a bag boundary',()=>{const q=menu.createMenuQuoteSelector(()=>['old','new','old'],()=>0);assert.deepEqual([q('u'),q('u'),q('u'),q('u')],['old','new','old','new']);const bad=menu.createMenuQuoteSelector(()=>['old','new'],()=>{throw Error('rng')});assert.equal(bad('u'),'old');assert.equal(bad('u'),'new');for(const name of ['menu','allmenu']){const h=createHarness();let prev;for(let i=0;i<30;i++){const cur=h.sandbox._randomMenuQuoteForUser(name);assert.notEqual(cur,prev);assert.ok(quotes.includes(cur));prev=cur;}}});
test('oversized image caption is bounded proactively without losing content',async()=>{const sent=[];const msg={key:{id:'in',remoteJid:'chat'}};const sock={sendMessage:async(j,p)=>sent.push(p)};const text=menu.quoteSection('old')+'± 𝐏𝐈𝐍𝐆\n'.repeat(6000);await menu.deliverMenuCaption(sock,msg,text,[async()=>Buffer.from('image')],async(s,m,t)=>sent.push({text:t}));assert.ok(sent.length>1);assert.ok(sent[0].caption.length<=16000);assert.equal(sent.map(p=>p.caption||p.text).join(''),text);assert.ok(!sent[0].caption.includes('Read more'));});
test('explicit caption rejection uses image continuation without silent truncation',async()=>{const sent=[];const msg={key:{id:'in',remoteJid:'chat'}};const sock={sendMessage:async(j,p)=>{if(p.caption.length>2048)throw Error('caption exceeds maximum length');sent.push(p)}};const text=menu.quoteSection('old')+'± 𝐏𝐈𝐍𝐆\n'.repeat(900);await menu.deliverMenuCaption(sock,msg,text,[async()=>Buffer.from('image')],async(s,m,t)=>sent.push({text:t}));assert.equal(sent.filter(x=>x.image).length,1);assert.equal(sent.map(x=>x.caption||x.text).join(''),text);});
test('category hiding preserves registrations, aliases, late commands and shared helpers',()=>{
 const handler=async()=>42;
 const commands=new Map([['shared',{canonical:'shared',category:'FUN',handler}],['joke',{canonical:'joke',category:'FUN',handler}],['jokes',{canonical:'joke',isAlias:true,category:'FUN',handler}],['debug',{category:'DEBUG',handler}]]);
 const aliases=new Map([['jokes','joke']]);
 const categories=[{name:'FUN',cmds:['shared','joke']},{name:'TOOLS',cmds:['shared']},{name:'DEBUG',cmds:['debug']}];
 const policy=menu.installMenuCategoryPolicy(commands,aliases,categories);
 assert.equal(commands.get('shared').handler,handler);assert.equal(commands.get('joke').handler,handler);
 assert.equal(commands.get('jokes').handler,handler);assert.equal(aliases.get('jokes'),'joke');
 commands.set('secretGame',{category:'GAMES',handler});assert.ok(commands.has('secretGame'));
 assert.equal(policy.denied('joke',commands.get('joke')),false);
 assert.deepEqual(categories.map(c=>c.name),['TOOLS','DEBUG']);
 assert.deepEqual(menu.canonicalMenuEntries(commands,aliases,categories).map(e=>e.name),['debug','shared']);
});
test('retained aliases resolve to same handler, unique totals sum across categories',async()=>{const h=createHarness();assert.equal(h.commands.get('tt').handler,h.commands.get('tiktok').handler);assert.equal(h.aliases.get('tt'),'tiktok');const entries=menu.canonicalMenuEntries(h.commands,h.aliases,h.categories);const cats=menu.activeMenuCategories(h.commands,h.aliases,h.categories);assert.equal(entries.length,cats.reduce((n,c)=>n+c.cmds.length,0));assert.equal(h.sandbox.getPrimaryCommandCount(),entries.length);assert.equal(await h.commands.get('tt').handler(),undefined);});
test('legacy dispatch blocks execution-disabled names, not removed menu categories',()=>{
 const legacy=fs.readFileSync(path.join(ROOT,'case.js'),'utf8');
 assert.ok(legacy.includes('if (globalThis.__MIAS_DISABLED__?.(command)) return;'));
 assert.ok(!legacy.includes('__removedLegacyMenus.has(command)'));
 for(const label of ['FUN MENU','LOGO & EPHOTO','GAME MENU'])assert.ok(!legacy.includes(label));
});

test('actual menu and allmenu registrations route once, with exact branding and footer', async()=>{
 const h=createHarness();
 await h.commands.get('menu').handler(h.sock,h.msg,[]);
 assert.equal(h.sent.filter(x=>x.content.image).length,1);
 assert.match(image(h).caption, /\*M[\u200b]?IAS MDX\*/);
 assert.match(image(h).caption, /POWERED BY 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x$/);
 h.sent.length=0;
 await h.commands.get('allmenu').handler(h.sock,h.msg,[]);
 assert.equal(h.sent.filter(x=>x.content.image).length,1);
 assert.equal(h.commands.get('fullmenu').handler,h.commands.get('allmenu').handler);
});
test('public, owner, creator, group-admin and adult visibility share exactly the same totals',async()=>{
 for(const context of [
   {owner:false,creator:false,adultMode:false},
   {owner:true,creator:false,adultMode:true},
   {owner:false,creator:false,group:true,admin:true,adultMode:true},
   {owner:true,creator:true,safeMode:true},
 ]){
   const h=createHarness(context);
   const add=(name,opts)=>h.commands.set(name,{canonical:name,handler:async()=>{},category:'TOOLS',...opts});
   add('publicprobe',{});add('ownerprobe',{ownerOnly:true});add('creatorprobe',{creatorOnly:true});
   add('groupprobe',{groupOnly:true});add('adminprobe',{category:'GROUP',ownerOnly:true,adminOnly:true});
   add('risk',{});add('hiddenprobe',{hidden:true});add('internalprobe',{desc:'Internal: picker callback'});
   const access=await h.sandbox.menuVisibilityContext(h.sock,h.msg);
   const entries=menu.canonicalMenuEntries(h.commands,h.aliases,h.categories,access);
   const names=new Set(entries.map(x=>x.name));
   assert.ok(names.has('publicprobe'));
   assert.equal(names.has('ownerprobe'),!!context.owner);
   assert.equal(names.has('creatorprobe'),!!context.creator);
   assert.equal(names.has('groupprobe'),!!context.group);
   assert.equal(names.has('adminprobe'),!!context.owner || !!context.admin);
   assert.equal(names.has('risk'),!context.safeMode);
   assert.ok(!names.has('hiddenprobe'));assert.ok(!names.has('internalprobe'));
   assert.equal(entries.some(e=>['HENTAI','NSFW','ADULT'].includes(e.category)),context.adultMode!==false && !context.safeMode);
   await h.run();const main=image(h).caption;
   assert.ok(main.includes('→  '+entries.length+'\n'));
   h.sent.length=0;await h.run([],true);
   const all=h.sent.map(x=>x.content.caption||x.content.text||'').join('');
   assert.equal(all.split('\n').filter(x=>x.startsWith('± ')).length,entries.length);
   assert.equal(h.sandbox.getPrimaryCommandCount(access),entries.length);
 }
});
test('inaccessible categories never leak via direct category routes; admin lookup failure fails closed',async()=>{
 const h=createHarness({owner:false,creator:false,adultMode:false});
 h.commands.set('privateentry',{canonical:'privateentry',category:'PRIVATE',ownerOnly:true,handler:async()=>{}});
 for(const name of ['private','hentai','nsfw']){h.sent.length=0;await h.run([name]);assert.equal(image(h),undefined);assert.match(h.sent[0].content.text,/not found/);}
 const g=createHarness({owner:false,creator:false,group:true,admin:true});
 g.sandbox.isGroupAdmin=async()=>{throw Error('offline');};
 assert.equal((await g.sandbox.menuVisibilityContext(g.sock,g.msg)).admin,false);
});
test('legacy labels are presentation mappings only and do not newly delete command implementations',()=>{
 const labels=['NEXRAY-AI','NEXRAY-ANIME','NEXRAY-CANVAS','NEXRAY-DOWNLOADER','NEXRAY-EDITOR','NEXRAY-EPHOTO','NEXRAY-FUN','NEXRAY-GAMES','NEXRAY-INFO','NEXRAY-MAKER','NEXRAY-NEWS','NEXRAY-PAYMENT','NEXRAY-PRIMBON','NEXRAY-RANDOM','NEXRAY-SEARCH','NEXRAY-STALKER','NEXRAY-TEXTPRO','NEXRAY-TOOLS','NEXRAY-UPLOADER','GENERAL','AI','ANIME','MENU'];
 const commands=new Map(labels.map((category,i)=>['probe'+i,{category,canonical:'probe'+i,handler:async()=>i}]));
 const aliases=new Map(),categories=[];const originals=new Map(commands);
 menu.installMenuCategoryPolicy(commands,aliases,categories);
 for(const [name,entry] of originals)assert.equal(commands.get(name),entry);
 const cats=menu.activeMenuCategories(commands,aliases,categories);
 for(const label of labels){assert.ok(!cats.some(c=>c.name===label));assert.equal(menu.resolveMenuCategory([label],cats),null);}
 assert.ok(!cats.some(c=>c.name==='INTELLIGENCE'));assert.ok(!cats.some(c=>c.name==='ANIMATION'));
 assert.ok(!cats.some(c=>menu.REMOVED_MENU_CATEGORIES.has(c.name)));
});
test('disabled primary cannot leak through aliases; internal play callbacks are hidden without deleting them',()=>{
 const fn=async()=>{};
 const commands=new Map([
 ['play',{canonical:'play',category:'DOWNLOAD',handler:fn}],['song',{canonical:'play',category:'DOWNLOAD',handler:fn}],
 ['dead',{canonical:'dead',category:'TOOLS',disabled:true,handler:fn}],['deadalias',{canonical:'dead',category:'TOOLS',handler:fn}],
 ['playget',{canonical:'playget',category:'DOWNLOAD',desc:'Internal: deliver audio after play!',handler:fn}],
 ]);
 assert.deepEqual(menu.canonicalMenuEntries(commands,new Map([['song','play'],['deadalias','dead']])).map(e=>e.name),['play']);
 assert.ok(commands.has('playget'));assert.equal(commands.get('song').handler,fn);
});
test('new original quotes are unique, join every old collection, and preserve intentional spacing',()=>{
 assert.equal(new Set(menu.ORIGINAL_PHASE1_QUOTES).size,24);
 assert.ok(menu.ORIGINAL_PHASE1_QUOTES.every(q=>!quotes.includes(q)));
 assert.ok(source.includes('...(_MASSIVE_QUOTES || []), ...ORIGINAL_PHASE1_QUOTES,'));
 assert.equal(menu.quoteSection('test'),'> _"test"_\n\n');
 const select=menu.createMenuQuoteSelector(()=>[...quotes,...menu.ORIGINAL_PHASE1_QUOTES],()=>0.999999);
 assert.equal(select('u'),menu.ORIGINAL_PHASE1_QUOTES.at(-1));assert.notEqual(select('u'),menu.ORIGINAL_PHASE1_QUOTES.at(-1));
});
test('long text fallback is bounded, sequential, lossless and Unicode-safe at newline boundaries',async()=>{
 const text='x'.repeat(3999)+'\n😀'+'z'.repeat(8000)+'\n'+menu.quoteSection('unchanged');
 const sent=[];
 await menu.deliverMenuCaption({sendMessage:async()=>{throw Error('image offline');}},{key:{remoteJid:'chat',id:'in'}},text,[async()=>{throw Error('no picture');}],async(s,m,t)=>{sent.push(t);});
 assert.ok(sent.length>1);assert.ok(sent.every(t=>t.length<=4000));assert.equal(sent.join(''),text);
 for(const t of sent){assert.ok(!/[\uD800-\uDBFF]$/.test(t));assert.ok(!/^[\uDC00-\uDFFF]/.test(t));}
 assert.throws(()=>menu.splitMenuText('x',0),RangeError);assert.throws(()=>menu.splitMenuText('x',1),RangeError);
});
test('successful image is never duplicated if a continuation fails',async()=>{
 let images=0;
 await assert.rejects(menu.deliverMenuCaption({sendMessage:async()=>{images++;}},{key:{remoteJid:'chat'}},'x'.repeat(20000),[async()=>Buffer.from('a'),async()=>Buffer.from('b')],async()=>{throw Error('offline continuation');}),/offline continuation/);
 assert.equal(images,1);
});
test('main and all reactions are distinct from category aliases',()=>{
 assert.equal(menu.menuReaction('MAIN'),'🏷️');assert.equal(menu.menuReaction('ALL'),'🔗️');assert.equal(menu.menuReaction('INFO'),'📊');
});
test('settings wrapper visibility mirrors owner/admin/public-mode guards',()=>{
 const entry={handler:async()=>{},category:'SETTINGS',__v38OwnerGuard:true};
 assert.equal(menu.isMenuEntryVisible('setting',entry,{owner:false,group:false}),false);
 assert.equal(menu.isMenuEntryVisible('setting',entry,{owner:true}),true);
 assert.equal(menu.isMenuEntryVisible('setting',entry,{owner:false,group:true,admin:true,publicMode:true}),true);
 assert.equal(menu.isMenuEntryVisible('setting',entry,{owner:false,group:true,admin:true,publicMode:false}),false);
 assert.equal(menu.isMenuEntryVisible('sudo',entry,{owner:false,group:true,admin:true,publicMode:true}),false);
});
test('protected registrations and useful commands still have actual declaration sites',()=>{
 const files=[source,...fs.readdirSync(path.join(ROOT,'mias/features')).filter(f=>/\.(?:js|cjs)$/.test(f)).map(f=>fs.readFileSync(path.join(ROOT,'mias/features',f),'utf8')),...fs.readdirSync(path.join(ROOT,'mias')).filter(f=>/^precious.*\.cjs$/.test(f)).map(f=>fs.readFileSync(path.join(ROOT,'mias',f),'utf8'))];
 const registrations=new Set();
 for(const text of files){
  for(const match of text.matchAll(/\bcmd\(\s*(\[(?:\s*(?:"[^"]*"|'[^']*')\s*,?)*\s*\]|"[^"]*"|'[^']*')\s*,/g)){
   const names=vm.runInNewContext(match[1]);for(const name of [].concat(names))registrations.add(name.toLowerCase());
  }
 }
 // Legacy fallback commands (for example myip) are switch routes, not
 // canonical-registry entries; preserve them without inflating registry totals.
 const legacy=fs.readFileSync(path.join(ROOT,'case.js'),'utf8');
 for(const match of legacy.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g))registrations.add(match[1].toLowerCase());
 // .play's final binding is a Map override loop, not a cmd() call.
 const start=source.lastIndexOf('for (const n of ["play", "music", "song"]) {');
 const end=source.indexOf('\n    }',start)+6;
 const livePlay=new Map();
 vm.runInNewContext(source.slice(start,end),{commands:livePlay,aliases:new Map(),_cardHandler:async()=>{}});
 for(const name of livePlay.keys())registrations.add(name);
 assert.equal(livePlay.get('song').canonical,'play');
 assert.equal(livePlay.get('music').handler,livePlay.get('play').handler);
 for(const name of ['aio','tiktok','play','fulldp','setbio','setbotpic','setting','afk','unafk','calc','fetch','shazam','sticker','take','shorten','qr','ss','ip','myip','webinfo','save','time','vv','vv2','calendar','fdroid','getfile','codecompile','syntaxcheck'])assert.ok(registrations.has(name),name+' registration');
 assert.ok(source.includes('__miasFullDpHandler'));
 assert.equal((source.match(/cmd\(\['allmenu'/g)||[]).length,1);
 assert.equal((source.match(/cmd\(\['menu'/g)||[]).length,1);
});
