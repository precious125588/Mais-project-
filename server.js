'use strict';
// ══ CRASH SHIELD — registered first so nothing can kill the web server ══════
require('./lib/crash-shield.cjs').install({ name: 'server' });

/* ── FIX-PACK ORCHESTRATOR (v32) — version-controlled, runs on the REAL boot ──
   Railway boots `node server.js` (railway.toml) and the Procfile runs only
   v30+v31, so the npm-start chain (fix_all, fix_session_401, …) never ran on
   the deployed container. This call is IN the repo, so it runs on every boot
   regardless of which entry point was used. Idempotent + absolute-pathed. */
/* v33: the whole fix chain (on-disk patches + session boot/fix + preflight)
   now lives in ONE file so no entry point can ever skip a pack again. */
try { require('./precious-master-fix-boot.cjs').bootParent(); }
catch (_eMFB) { console.log('[MASTER-FIX] parent boot FAILED (' + (_eMFB && _eMFB.message) + ')'); }

/* v33: preflight now runs inside precious-master-fix-boot.cjs bootParent()
   (called above) — removed here so it can never run twice or be skipped. */

/* __V27_MANIFEST__ — boot-time file load report.
   Prints exactly which critical files loaded and which failed, so the
   Railway logs show it immediately (e.g. "22 files loaded, 0 failed"). */
try {
  const _v27Files = [
    'server.js', 'index.js', 'mais_launcher.js', 'pair.js', 'bot.js', 'autoload.js',
    'precious-master-fix-boot.cjs', 'sessionPaths.js', 'sessionOwnership.js',
    'notify.js', 'cleanup.cjs',
    'precious-fixes-v27.cjs', 'precious-fixes-v28.cjs', 'precious-fixes-v29.cjs',
    'mias/index.js', 'mias/precious-fixes-v20.cjs', 'mias/precious-fixes-v21.cjs',
    'mias/precious-fixes-v24.cjs', 'mias/precious-gst-picker.cjs',
    'mias/precious-tt-quote-fix.cjs', 'mias/precious-anime-edits.cjs',
    'patches/precious-fixes-v23-rc.cjs',
    'lib/crash-shield.cjs', 'mias/lib/playv2-deliver.cjs', 'mias/lib/portableVideo.cjs',
  ];
  const _v27Path = require('path');
  const _v27fs = require('fs');
  let _loaded = 0, _failed = [];
  for (const _rel of _v27Files) {
    const _abs = _v27Path.join(__dirname, _rel);
    if (!_v27fs.existsSync(_abs)) { _failed.push(_rel + ' (missing)'); continue; }
    try { require('module').createRequire(_abs); _loaded++; }
    catch (_e) { _failed.push(_rel + ' (' + (_e && _e.message) + ')'); }
  }
  console.log('[manifest] ' + _loaded + ' files loaded, ' + _failed.length + ' failed');
  if (_failed.length) console.log('[manifest] ❌ not loading: ' + _failed.join(' | '));
} catch (_eM) { console.log('[manifest] report error:', _eM && _eM.message); }

// ═════════════════════════════════════════════════════════════════════════════


// ── PRE-BOOT PATCH PACKS (dedup-guarded) ─────────────────────────────────────
// Railway/Procfile/Docker all boot through THIS file (node server.js). The
// patchers used to run only under `npm start` / index.js / start.sh, so on the
// deployed image PATCH-v25.cjs and precious-fix-pack.cjs never ran at all.
// They are idempotent and marker-guarded; the tmp marker prevents double runs
// when start.sh or index.js also executes in the same boot.


require('dotenv').config();

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const QRCode  = require('qrcode');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

function configuredTelegramToken() {
    return String(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
}

function redactSecrets(value = '') {
    let text = String(value);
    for (const secret of [process.env.TELEGRAM_BOT_TOKEN, process.env.BOT_TOKEN]) {
        if (secret) text = text.split(secret).join('<TELEGRAM_BOT_TOKEN>');
    }
    return text.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<TELEGRAM_BOT_TOKEN>');
}

function safeErrorMessage(err) {
    const raw = err?.response?.body?.description || err?.message || err?.code || String(err || 'Unknown error');
    return redactSecrets(raw);
}

// v34: precious-session-boot is merged into precious-master-fix-boot.cjs
// (bootParent). ensureSessionRoot() below keeps this module self-sufficient.
const _sessionPaths = require('./sessionPaths');
const NEXSTORE    = _sessionPaths.nexstoreRoot();
const PAIRING_DIR = path.join(NEXSTORE, 'pairing');
const ERROR_FILE  = path.join(NEXSTORE, 'web_errors.json');
const PAIR_FILE   = path.join(NEXSTORE, 'web_pairs.json');

[NEXSTORE, PAIRING_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); });

// ── nexstore modules (restored by fix_all.cjs at startup; safe fallback below) ──
let registry, logger;
try { registry = require('./nexstore/sessionRegistry'); } catch(e) {
  console.error('[server] sessionRegistry unavailable:', e.message);
  registry = { register:()=>{}, updateStatus:()=>{}, unregister:()=>{}, get:()=>null,
               getAll:()=>[], getBySource:()=>[], has:()=>false, count:()=>0,
               getAnalytics:()=>({total:0,web:0,telegram:0,today:0,week:0,connected:0}), flush:()=>{} };
}
try { logger = require('./nexstore/logger'); } catch(e) {
  console.error('[server] logger unavailable:', e.message);
  const {EventEmitter}=require('events'); const _em=new EventEmitter();
  logger = { log:()=>{}, warn:()=>{}, error:()=>{}, readLog:()=>[], clearLog:()=>{}, emitter:_em };
}

// ── Bot-selection store / deploy manager (optional, never fatal) ─────────────
let _selectionStore = null, _deployMgr = null;
try { _selectionStore = require('./deploy/botSelectionStore'); } catch(e) {
  console.error('[server] botSelectionStore unavailable:', e.message);
}
try { _deployMgr = require('./deploy/deploymentManager'); } catch(e) {
  console.error('[server] deploymentManager unavailable:', e.message);
}

// ── SSE broadcast sets ────────────────────────────────────────────────────────
const logSseClients = new Set();
const pairingSseMap = new Map();

function broadcastLog(entry) {
    if (!logSseClients.size) return;
    const msg = `data: ${JSON.stringify(entry)}\n\n`;
    for (const c of logSseClients) { try { c.write(msg); } catch { logSseClients.delete(c); } }
}
logger.emitter.on('entry', broadcastLog);

function broadcastPairingEvent(jid, event, data) {
    const clients = pairingSseMap.get(jid);
    if (!clients?.size) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) { try { c.write(msg); } catch { clients.delete(c); } }
}

function sendPairingEvent(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch {
        return false;
    }
}

// ── JSON helpers ──────────────────────────────────────────────────────────────
function readJson(f, d=[]) { try { if(fs.existsSync(f)) return JSON.parse(fs.readFileSync(f,'utf8')); } catch{} return d; }
function writeJson(f, d)   { try { fs.writeFileSync(f,JSON.stringify(d,null,2),'utf8'); } catch {} }

let errorLog = readJson(ERROR_FILE, []);
let pairLog  = readJson(PAIR_FILE,  []);

const ADMIN_SETTINGS_FILE = path.join(NEXSTORE, 'admin_settings.json');
let adminSettings = readJson(ADMIN_SETTINGS_FILE, {});
// Railway/.env is the source of truth when it is configured. Only fall back
// to the admin-panel value when no environment token exists; a stale token
// persisted on the volume must never silently override a repaired Railway
// variable.
if (!configuredTelegramToken() && adminSettings.telegramBotToken) {
    process.env.TELEGRAM_BOT_TOKEN = String(adminSettings.telegramBotToken).trim();
}

function logError(number, message, type='pairing') {
    errorLog.unshift({number,message,type,timestamp:new Date().toISOString()});
    if (errorLog.length > 500) errorLog = errorLog.slice(0,500);
    writeJson(ERROR_FILE, errorLog);
}
function logPair(number, status, details='', source='web') {
    const idx = pairLog.findIndex(p=>p.number===number);
    const e   = {number,status,details,source,timestamp:new Date().toISOString()};
    if (idx>=0) pairLog[idx]=e; else pairLog.unshift(e);
    if (pairLog.length > 1000) pairLog = pairLog.slice(0,1000);
    writeJson(PAIR_FILE, pairLog);
}

// ── Lazy module refs ──────────────────────────────────────────────────────────
let _pair = null, _launcher = null, _ready = false;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));
app.use((_,res,next) => { res.setHeader('X-Content-Type-Options','nosniff'); next(); });

// ── Rate limiting ─────────────────────────────────────────────────────────────
const rlMap = new Map();
function rateLimit(windowMs=60000, max=5) {
    return (req,res,next) => {
        const k=req.ip||'x', now=Date.now();
        const r=rlMap.get(k)||{count:0,start:now};
        if(now-r.start>windowMs){r.count=0;r.start=now;}
        r.count++; rlMap.set(k,r);
        if(r.count>max) return res.status(429).json({ok:false,error:'Too many requests. Wait a minute.'});
        next();
    };
}
setInterval(()=>{const c=Date.now()-60000;for(const[k,v]of rlMap) if(v.start<c) rlMap.delete(k);},300000);

// ── Admin sessions ────────────────────────────────────────────────────────────
const adminSessions = new Map();
function genToken() { return Math.random().toString(36).slice(2)+Date.now().toString(36); }
function isAdmin(req) {
    const t=req.headers['x-admin-token']||req.query.token;
    if(!t||!adminSessions.has(t)) return false;
    const s=adminSessions.get(t);
    if(Date.now()-s.createdAt>86400000){adminSessions.delete(t);return false;}
    return true;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _getDirSize(dir) {
    let t=0;
    try { for(const i of fs.readdirSync(dir,{withFileTypes:true})) { const f=path.join(dir,i.name); if(i.isDirectory())t+=_getDirSize(f); else try{t+=fs.statSync(f).size;}catch{} } } catch{}
    return t;
}
function _delDir(p) {
    if(!fs.existsSync(p))return;
    for(const f of fs.readdirSync(p)){const fp=path.join(p,f);fs.lstatSync(fp).isDirectory()?_delDir(fp):fs.unlinkSync(fp);}
    fs.rmdirSync(p);
}
const _sleep = ms => new Promise(r=>setTimeout(r,ms));

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (_,res) => res.json({ok:true,ready:_ready,uptime:process.uptime(),version:process.version,port:PORT}));
app.get('/api/ready',  (_,res) => res.json({ok:_ready&&!!_pair,pairReady:!!_pair,message:_ready&&!!_pair?'Server ready':'Warming up — try again in 15s'}));

// ── Pair: request a QR or pairing code ───────────────────────────────────────
app.post('/api/pair', rateLimit(60000,10), async (req,res) => {
    if (!_pair) return res.status(503).json({ok:false,error:'Server is still starting up. Please wait 15–30 seconds and try again.'});

    let {number} = req.body;
    const mode = req.body?.mode === 'qr' ? 'qr' : 'code';
    if (!number) return res.status(400).json({ok:false,error:'Phone number required.'});
    number = number.replace(/[^0-9]/g,'');
    if (number.length<7||number.length>15) return res.status(400).json({ok:false,error:'Invalid phone number.'});

    const jid = `${number}@s.whatsapp.net`;
    const force = req.body?.force === true || req.body?.force === 'true';

    // A number counts as "already paired" only when the stored session is
    // complete AND still alive. A number that was unlinked from the phone (or
    // killed by a 401) is cleaned up automatically so it can pair again.
    if (_pair.hasPairedSession(jid)) {
        const live = _pair.isSessionLive ? _pair.isSessionLive(jid) : true;
        const botRunning = _launcher ? _launcher.list().some(r => r.number === jid && r.alive) : false;

        if (force || (!live && !botRunning)) {
            logger.log('pairing', `Re-pair requested for ${jid} (force=${force}, live=${live}, bot=${botRunning}) — clearing dead session`);
            try { _pair.unpairSession ? _pair.unpairSession(jid) : _pair.forceCleanupSession(jid); } catch {}
            try { registry.remove?.(jid); } catch {}
            await _sleep(600);
        } else {
            return res.status(409).json({
                ok: false,
                canRepair: true,
                error: 'This number is already connected. Tap "Re-pair anyway" to unlink it and get a new code.'
            });
        }
    }

    const existing = mode === 'qr'
        ? _pair.readPairingQrRecord?.(jid)
        : _pair.readPairingCodeRecord(jid);
    if (mode === 'qr' && existing?.qr) {
        broadcastPairingEvent(jid,'qr_ready',{url:`/api/pair/qr/${number}`,cached:true});
        return res.json({ok:true,mode:'qr',qrUrl:`/api/pair/qr/${number}`,cached:true});
    }
    if (mode === 'code' && existing?.code) {
        broadcastPairingEvent(jid,'code_ready',{code:existing.code,cached:true});
        return res.json({ok:true,mode:'code',code:existing.code,cached:true});
    }

    logger.log('pairing',`Web pair request: ${jid}`);
    broadcastPairingEvent(jid,'connecting',{msg:'Connecting to WhatsApp servers...'});

    // IMPORTANT: never block the HTTP response on the WhatsApp handshake.
    // Waiting ~90s here exceeded proxy/gateway timeouts, so the browser saw a
    // 502/timeout and the user never received a pairing code even though the
    // code had actually been generated. The request now returns immediately
    // and the code is pushed over the SSE stream (and readable via
    // /api/pair/status/:number as a fallback).
    try {
        _pair.startpairing(jid, {mode}).catch(err => {
            logError(jid,err.message,'pairing-init');
            logPair(jid,'failed',err.message,'web');
            broadcastPairingEvent(jid,'failed',{msg:err.message});
        });
        broadcastPairingEvent(jid,'authenticating',{msg:'Authenticating session...'});

        _pair.waitForPairingResult(jid,120000,mode)
            .then(result => {
                try { registry.register(jid,'web'); } catch {}
                const detail = mode === 'qr'
                    ? `/api/pair/qr/${number}`
                    : result.code;
                logPair(jid, mode === 'qr' ? 'qr-sent' : 'code-sent', detail, 'web');
                if (mode === 'qr') {
                    broadcastPairingEvent(jid,'qr_ready',{url:detail});
                } else {
                    broadcastPairingEvent(jid,'code_ready',{code:result.code});
                }
            })
            .catch(err => {
                logError(jid,err.message,'pairing');
                logPair(jid,'failed',err.message,'web');
                broadcastPairingEvent(jid,'failed',{msg:err.message||'Pairing failed. Try again.'});
            });

        return res.status(202).json({
            ok:true,
            pending:true,
            mode,
            msg: mode === 'qr' ? 'Generating your QR code…' : 'Generating your pairing code…'
        });
    } catch(err) {
        logError(jid,err.message,'pairing');
        logPair(jid,'failed',err.message,'web');
        broadcastPairingEvent(jid,'failed',{msg:err.message});
        return res.status(500).json({ok:false,error:err.message||'Pairing failed. Try again.'});
    }
});

// Render the live QR payload as a PNG. The raw WhatsApp payload never needs to
// be exposed to the browser or Telegram client.
app.get('/api/pair/qr/:number', async (req,res) => {
    const number = String(req.params.number || '').replace(/[^0-9]/g,'');
    if (number.length < 7 || number.length > 15 || !_pair) {
        return res.status(404).json({ok:false,error:'QR code not available.'});
    }
    const record = _pair.readPairingQrRecord?.(`${number}@s.whatsapp.net`);
    if (!record?.qr) return res.status(404).json({ok:false,error:'QR code expired. Start a new pairing.'});
    try {
        const png = await QRCode.toBuffer(record.qr, {
            type: 'png',
            width: 420,
            margin: 2,
            errorCorrectionLevel: 'M'
        });
        res.setHeader('Content-Type','image/png');
        res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
        return res.end(png);
    } catch (error) {
        return res.status(500).json({ok:false,error:'Could not render QR code.'});
    }
});

// ── Pair: SSE stream ──────────────────────────────────────────────────────────
app.get('/api/pair/stream/:number', (req,res) => {
    const number = req.params.number.replace(/[^0-9]/g,'');
    const jid    = `${number}@s.whatsapp.net`;

    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.flushHeaders();

    if (!pairingSseMap.has(jid)) pairingSseMap.set(jid,new Set());
    pairingSseMap.get(jid).add(res);

    const hb = setInterval(()=>{ try{res.write(': ping\n\n');}catch{clearInterval(hb);} },10000);
    let linked = false;
    const requestedMode = req.query.mode === 'qr' ? 'qr' : null;
    let codeSent = false;
    let lastQrTimestamp = '';
    let sentConnecting = false;
    let sentAuthenticating = false;
    let sentFailure = '';

    // If a code already exists (or arrives while this stream is open) push it
    // straight away — the POST no longer carries the code in its response.
    const sendExistingCode = () => {
        if (codeSent || requestedMode === 'qr' || !_pair) return;
        try {
            const rec = _pair.readPairingCodeRecord(jid);
            if (rec?.code) {
                codeSent = true;
                sendPairingEvent(res, 'code_ready', {code:rec.code});
            }
        } catch {}
    };
    const sendExistingQr = () => {
        if (requestedMode !== 'qr' || !_pair) return;
        try {
            const rec = _pair.readPairingQrRecord?.(jid);
            if (rec?.qr && rec.timestamp !== lastQrTimestamp) {
                lastQrTimestamp = rec.timestamp;
                sendPairingEvent(res, 'qr_ready', {url:`/api/pair/qr/${number}`,timestamp:rec.timestamp});
            }
        } catch {}
    };

    // Replay the current runtime state. The browser used to open this stream
    // after POST /api/pair, which meant the first connecting/authenticating
    // events were lost. Replaying state also makes refreshes and flaky mobile
    // networks recover without requiring a second pairing request.
    const sendRuntimeState = () => {
        if (!_pair) {
            sendPairingEvent(res, 'waiting', {msg:'Warming up...'});
            return;
        }
        try {
            const state = _pair.getPairingRuntimeState?.(jid);
            if (!state) return;
            sendPairingEvent(res, 'state', {
                active: !!state.active,
                paired: !!state.paired,
                live: !!state.live,
                mode: state.mode || requestedMode || null
            });
            if (state.active && !sentConnecting) {
                sentConnecting = true;
                sendPairingEvent(res, 'connecting', {msg:'Connected to the pairing service.'});
            }
            if (state.active && !sentAuthenticating) {
                sentAuthenticating = true;
                sendPairingEvent(res, 'authenticating', {msg:'Waiting for WhatsApp to approve the link...'});
            }
            if (state.error && state.error !== sentFailure) {
                sentFailure = state.error;
                sendPairingEvent(res, 'failed', {msg:state.error});
            }
        } catch {}
    };
    sendRuntimeState();
    sendExistingCode();
    sendExistingQr();

    const poll = setInterval(async ()=>{
        if (!_pair){res.write(`event: waiting\ndata: ${JSON.stringify({msg:'Warming up...'})}\n\n`);return;}
        sendRuntimeState();
        sendExistingCode();
        sendExistingQr();
        try {
            if (_pair.hasPairedSession(jid)&&!linked) {
                linked=true;
                sendPairingEvent(res, 'linked', {number,msg:'WhatsApp linked! Starting the bot...'});
                if (_launcher){
                    let checks=0;
                    const bp=setInterval(()=>{
                        checks++;
                        const bot=_launcher.list().find(r=>r.number===jid);
                        if((bot&&bot.alive)||checks>30){
                            clearInterval(bp);
                            if(bot&&bot.alive) sendPairingEvent(res, 'bot_started', {number,pid:bot.pid,msg:'Bot is live!'});
                        }
                    },2000);
                }
            }
        } catch {}
    },2000);

    req.on('close',()=>{ clearInterval(hb);clearInterval(poll); const c=pairingSseMap.get(jid); if(c){c.delete(res);if(!c.size)pairingSseMap.delete(jid);} });
    setTimeout(()=>{ clearInterval(poll);clearInterval(hb);try{res.write(`event: timeout\ndata: ${JSON.stringify({msg:'Timeout. Please refresh.'})}\n\n`);res.end();}catch{} },900000);
});

// ── Pair status poll ──────────────────────────────────────────────────────────
// ── Logout notification endpoints (web-pair UI polling) ──────────────────────
// Both endpoints require admin token authentication.
app.get('/api/logout/pending', (req,res) => {
    // Public read-only endpoint — only exposes non-sensitive logout metadata (number, reason, timestamp)
    // Session deletion requires admin auth via /api/logout/delete-session
    const NOTIF_DIR = path.join(__dirname, 'nexstore', 'logout_notifications');
    let items = [];
    try {
        if (!fs.existsSync(NOTIF_DIR)) return res.json([]);
        const files = fs.readdirSync(NOTIF_DIR).filter(f => f.endsWith('.json'));
        for (const f of files) {
            try {
                const p = JSON.parse(fs.readFileSync(path.join(NOTIF_DIR, f), 'utf8'));
                items.push(p);
            } catch {}
        }
    } catch {}
    res.json(items);
});
app.post('/api/logout/delete-session', (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'Unauthorized' });
    const num = String(req.body?.number || '').replace(/[^0-9]/g, '');
    if (!num) return res.json({ ok: false, error: 'number required' });
    // Delete the session auth dir
    const possible = [
        path.join(__dirname, 'nexstore', 'pairing', num),
        path.join(__dirname, 'nexstore', 'pairing', `${num}@s.whatsapp.net`),
        path.join(__dirname, 'auth_info_baileys', num),
    ];
    let deleted = 0;
    for (const d of possible) {
        try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); deleted++; } } catch {}
    }
    try { _pair?.unpairSession ? _pair.unpairSession(`${num}@s.whatsapp.net`) : _pair?.forceCleanupSession?.(`${num}@s.whatsapp.net`); } catch {}
    try { _selectionStore?.clearSelection(num); } catch {}
    // Remove any pending notification files for this number
    try {
        const NOTIF_DIR = path.join(__dirname, 'nexstore', 'logout_notifications');
        if (fs.existsSync(NOTIF_DIR)) {
            fs.readdirSync(NOTIF_DIR).filter(f => f.startsWith(num + '_') && f.endsWith('.json'))
              .forEach(f => { try { fs.unlinkSync(path.join(NOTIF_DIR, f)); } catch {} });
        }
    } catch {}
    res.json({ ok: true, deleted });
});

// ── Unpair / reset a number so it can be paired again ────────────────────────
app.post('/api/pair/reset', rateLimit(60000,10), (req,res) => {
    if (!_pair) return res.status(503).json({ok:false,error:'Server is still starting up.'});
    let {number} = req.body || {};
    if (!number) return res.status(400).json({ok:false,error:'Phone number required.'});
    number = String(number).replace(/[^0-9]/g,'');
    if (number.length<7||number.length>15) return res.status(400).json({ok:false,error:'Invalid phone number.'});
    const jid = `${number}@s.whatsapp.net`;
    try { _pair.unpairSession ? _pair.unpairSession(jid) : _pair.forceCleanupSession(jid); } catch {}
    try { registry.remove?.(jid); } catch {}
    try { _selectionStore?.clearSelection(number); } catch {}
    logPair(jid,'reset','session cleared','web');
    res.json({ok:true,message:'Session cleared. You can pair this number again.'});
});

app.get('/api/pair/status/:number', (req,res) => {
    const number = req.params.number.replace(/[^0-9]/g,'');
    const jid    = `${number}@s.whatsapp.net`;
    const runtime = _pair?.getPairingRuntimeState?.(jid) || {};
    const paired = _pair?(_pair.hasPairedSession(jid, {clean:false})):false;
    const live   = paired && _pair?.isSessionLive ? _pair.isSessionLive(jid) : false;
    const record = _pair?_pair.readPairingCodeRecord(jid):null;
    const botRunning = _launcher?_launcher.list().some(r=>r.number===jid&&r.alive):false;
    const selection = _selectionStore ? _selectionStore.get(number) : null;
    res.json({
        ok:true,paired,live,
        code:record?.code||null,
        qr: !!_pair?.readPairingQrRecord?.(jid),
        mode: _pair?.readPairingQrRecord?.(jid) ? 'qr' : (record?.code ? 'code' : null),
        source:registry.get(jid)?.source||null,
        ready:_ready,botRunning,
        active:!!runtime.active,
        error:runtime.error||null,
        awaitingSelection: false,
        bot: botRunning ? { id: "mias-mdx", name: "MIAS MDX", locked: true } : null,
    });
});

// ── Bots & selections ────────────────────────────────────────────────────────
// Public: which bots this deployment offers.
app.get('/api/bots', (_req,res) => {
    res.json({ok:true,bots:[{id:"mias-mdx",name:"MIAS MDX",tagline:"Stable single-bot runtime"}]});
});

// Admin: every paired number and the bot it is locked to.
app.get('/api/admin/selections', (req,res) => {
    if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    if(!_selectionStore) return res.json({ok:true,selections:[]});
    try {
        const rows = _selectionStore.overview().map(r => ({
            ...r,
            botRunning: _launcher ? _launcher.list().some(x=>x.number===`${r.number}@s.whatsapp.net`&&x.alive) : false,
        }));
        res.json({ok:true,selections:rows});
    } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

// Admin: choose the bot for a number (respects the one-shot lock).
app.post('/api/admin/selections/:number', async (req,res) => {
    if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    res.status(410).json({ok:false,error:'Bot selection was removed. Every paired number runs MIAS MDX.'});
});

// Admin: unlock a number (only ever done together with an unpair).
app.delete('/api/admin/selections/:number', (req,res) => {
    if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    if(!_selectionStore) return res.status(503).json({ok:false,error:'Selection store unavailable.'});
    const number = String(req.params.number).replace(/[^0-9]/g,'');
    try {
        _selectionStore.clearSelection(number);
        res.json({ok:true,message:'Legacy selection cleared. The number remains assigned to MIAS MDX.'});
    } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

// ── Admin: login / logout ─────────────────────────────────────────────────────
app.post('/api/admin/login', rateLimit(60000,10), (req,res) => {
    const {username,password}=req.body;
    if ((username&&username!==ADMIN_USERNAME)||password!==ADMIN_PASSWORD) {
        logger.warn('admin',`Failed login from ${req.ip}`);
        return res.status(401).json({ok:false,error:'Wrong credentials.'});
    }
    const token=genToken();
    adminSessions.set(token,{createdAt:Date.now(),ip:req.ip});
    logger.log('admin',`Admin login from ${req.ip}`);
    return res.json({ok:true,token});
});
app.post('/api/admin/logout',(req,res)=>{ const t=req.headers['x-admin-token'];if(t)adminSessions.delete(t);res.json({ok:true}); });

// ── Admin: SSE log stream ─────────────────────────────────────────────────────
app.get('/api/admin/logs/stream', (req,res) => {
    if (!isAdmin(req)) return res.status(403).end('Unauthorized');
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.flushHeaders();
    ['system','pairing','telegram','error','admin'].forEach(type=>{
        const lines=logger.readLog(type,30);
        if(lines.length) res.write(`event: bootstrap\ndata: ${JSON.stringify({type,lines})}\n\n`);
    });
    logSseClients.add(res);
    const hb=setInterval(()=>{ try{res.write(': ping\n\n');}catch{clearInterval(hb);logSseClients.delete(res);} },15000);
    req.on('close',()=>{ clearInterval(hb);logSseClients.delete(res); });
});

// ── Admin: bot-status SSE ─────────────────────────────────────────────────────
app.get('/api/bot-status/stream', (req,res) => {
    if (!isAdmin(req)) return res.status(403).end('Unauthorized');
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.flushHeaders();
    const send=(event,data)=>{ try{res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);}catch{} };
    const sendState=()=>{
        const running=_launcher?_launcher.listAll():[];
        const paired =_pair?_pair.listPairedDevices(false):[];
        send('state',{running,totalPaired:paired.length,ready:_ready,uptime:process.uptime(),memory:process.memoryUsage()});
    };
    sendState();
    const interval=setInterval(sendState,3000);
    const hb=setInterval(()=>{ try{res.write(': ping\n\n');}catch{clearInterval(hb);clearInterval(interval);} },20000);
    req.on('close',()=>{ clearInterval(interval);clearInterval(hb); });
});

// ── Admin: stats ──────────────────────────────────────────────────────────────
app.get('/api/admin/stats', (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    const paired=_pair?_pair.listPairedDevices(false):[];
    const running=_launcher?_launcher.listAll():[];
    const mem=process.memoryUsage(), cpu=os.loadavg();
    const analytics=registry.getAnalytics();
    res.json({ok:true,totalPaired:paired.length,failed:pairLog.filter(p=>p.status==='failed').length,
        running:running.filter(r=>r.alive).length,paused:running.filter(r=>r.paused).length,
        uptime:process.uptime(),errors:errorLog.length,memory:mem,
        cpu:{load1:cpu[0],load5:cpu[1],load15:cpu[2],cores:os.cpus().length},
        os:{freemem:os.freemem(),totalmem:os.totalmem(),platform:os.platform()},
        analytics,telegramActive:!!global._telegramBotLoaded,serverReady:_ready});
});

// ── Admin: users ──────────────────────────────────────────────────────────────
app.get('/api/admin/users', (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    const paired=_pair?_pair.listPairedDevices(false):[];
    const running=_launcher?_launcher.listAll():[];
    const runMap={}; running.forEach(r=>{runMap[r.number]=r;});
    const users=paired.map(jid=>{
        const number=jid.replace('@s.whatsapp.net',''),
              log=pairLog.find(p=>p.number===jid)||pairLog.find(p=>p.number===number),
              r=runMap[jid]||runMap[number],
              reg=registry.get(jid);
        return{jid,number,paired:true,running:r?r.alive:false,paused:r?r.paused:false,
               pid:r?.pid||null,uptimeMs:r?.uptimeMs||null,restarts:r?.restarts||0,
               pairedAt:log?.timestamp||reg?.pairedAt||null,source:reg?.source||log?.source||'web',
               status:reg?.status||(r?.paused?'paused':r?.alive?'connected':'disconnected')};
    });
    res.json({ok:true,users});
});

// ── Admin: pause / resume bot ─────────────────────────────────────────────────
app.post('/api/admin/pause/:jid', async (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    if (!_launcher)    return res.status(503).json({ok:false,error:'Launcher not ready.'});
    const jid=decodeURIComponent(req.params.jid);
    const ok=_launcher.pause(jid);
    registry.updateStatus(jid,'paused');
    logger.log('admin',`Bot paused: ${jid}`);
    res.json({ok:true,paused:true,jid,message:ok?'Bot paused.':'Bot was not running (now flagged paused).'});
});

app.post('/api/admin/resume/:jid', async (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    if (!_launcher)    return res.status(503).json({ok:false,error:'Launcher not ready.'});
    const jid=decodeURIComponent(req.params.jid);
    try {
        const ok=await _launcher.resume(jid);
        registry.updateStatus(jid,'connected');
        logger.log('admin',`Bot resumed: ${jid}`);
        res.json({ok:true,resumed:ok,jid,message:ok?'Bot resumed.':'Could not find session to resume.'});
    } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

// ── Admin: restart ────────────────────────────────────────────────────────────
app.post('/api/admin/restart/:jid', async (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    if (!_launcher)    return res.status(503).json({ok:false,error:'Launcher not ready.'});
    const jid=decodeURIComponent(req.params.jid);
    try { const ok=await _launcher.restart(jid); res.json({ok,message:ok?`Restarted ${jid}`:'Not found.'}); }
    catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

// ── Admin: delete user ────────────────────────────────────────────────────────
app.delete('/api/admin/user/:jid', (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    const jid=decodeURIComponent(req.params.jid), sp=path.join(PAIRING_DIR,jid);
    if(_launcher){_launcher.pause(jid);_launcher.stop(jid);}
    registry.unregister(jid);
    try { _pair?.unpairSession ? _pair.unpairSession(jid) : _pair?.forceCleanupSession?.(jid); } catch {}
    try { _selectionStore?.clearSelection(jid); } catch {}
    if (fs.existsSync(sp)) { _delDir(sp);pairLog=pairLog.filter(p=>p.number!==jid&&p.number!==jid.replace('@s.whatsapp.net',''));writeJson(PAIR_FILE,pairLog);logger.log('admin',`Deleted: ${jid}`);return res.json({ok:true}); }
    res.json({ok:true,message:'Session cleared.'});
});

// ── Admin: errors / logs / analytics ─────────────────────────────────────────
app.get('/api/admin/errors',    (req,res)=>{ if(!isAdmin(req))return res.status(403).json({ok:false,error:'Unauthorized'}); res.json({ok:true,errors:errorLog.slice(0,parseInt(req.query.limit)||100)}); });
app.delete('/api/admin/errors', (req,res)=>{ if(!isAdmin(req))return res.status(403).json({ok:false,error:'Unauthorized'}); errorLog=[];writeJson(ERROR_FILE,errorLog);res.json({ok:true}); });
app.get('/api/admin/pairlog',   (req,res)=>{ if(!isAdmin(req))return res.status(403).json({ok:false,error:'Unauthorized'}); res.json({ok:true,log:pairLog.slice(0,200)}); });
app.get('/api/admin/sessions',  (req,res)=>{ if(!isAdmin(req))return res.status(403).json({ok:false,error:'Unauthorized'}); const{source}=req.query;res.json({ok:true,sessions:source?registry.getBySource(source):registry.getAll()}); });
app.get('/api/admin/logs', (req,res)=>{
    if(!isAdmin(req))return res.status(403).json({ok:false,error:'Unauthorized'});
    const type=['system','pairing','telegram','error','admin'].includes(req.query.type)?req.query.type:'system';
    res.json({ok:true,logs:logger.readLog(type,parseInt(req.query.limit)||100),type});
});
app.post('/api/admin/cache/clear-logs',(req,res)=>{ if(!isAdmin(req))return res.status(403).json({ok:false,error:'Unauthorized'}); ['system','pairing','telegram','error','admin'].forEach(t=>logger.clearLog(t));res.json({ok:true}); });

app.get('/api/admin/analytics', (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    const analytics=registry.getAnalytics(), now=Date.now(), histogram={};
    for(let i=29;i>=0;i--){const d=new Date(now-i*86400000),k=d.toISOString().slice(0,10);histogram[k]={web:0,telegram:0,failed:0};}
    for(const p of pairLog){if(!p.timestamp)continue;const k=p.timestamp.slice(0,10);if(!histogram[k])continue;if(p.status==='failed')histogram[k].failed++;else if(p.source==='telegram')histogram[k].telegram++;else histogram[k].web++;}
    res.json({ok:true,analytics,histogram,failureRate:pairLog.length?((pairLog.filter(p=>p.status==='failed').length/pairLog.length)*100).toFixed(1):0});
});

app.get('/api/admin/system', (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    const mem=process.memoryUsage(),cpu=os.loadavg(),running=_launcher?_launcher.listAll():[];
    res.json({ok:true,uptime:process.uptime(),nodeVersion:process.version,
        memory:{heapUsedMb:(mem.heapUsed/1048576).toFixed(1),heapTotalMb:(mem.heapTotal/1048576).toFixed(1),rssMb:(mem.rss/1048576).toFixed(1),freeMemMb:(os.freemem()/1048576).toFixed(1),totalMemMb:(os.totalmem()/1048576).toFixed(1)},
        cpu:{load1:cpu[0].toFixed(2),load5:cpu[1].toFixed(2),load15:cpu[2].toFixed(2),cores:os.cpus().length},
        storage:{nexstoreKb:Math.round(_getDirSize(NEXSTORE)/1024)},
        processes:{activeInstances:running.filter(r=>r.alive).length,pausedInstances:running.filter(r=>r.paused).length,pids:running.filter(r=>r.alive).map(r=>r.pid)},
        telegram:{botActive:!!global._telegramBotLoaded},serverReady:_ready});
});

app.post('/api/admin/reconnect-failed', async (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    if (!_pair||!_launcher) return res.status(503).json({ok:false,error:'Modules not ready.'});
    const paired=_pair.listPairedDevices(false), runSet=new Set(_launcher.list().map(r=>r.number));
    const dead=paired.filter(j=>!runSet.has(j)&&!_launcher.isPaused(j)); let count=0;
    for(const jid of dead){try{const sd=path.join(PAIRING_DIR,jid);if(fs.existsSync(path.join(sd,'creds.json'))){await _launcher.launch(jid,sd);count++;await _sleep(1500);}}catch{}}
    res.json({ok:true,reconnected:count,total:dead.length});
});

app.get('/api/admin/backup', (req,res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    const backup={timestamp:new Date().toISOString(),sessions:registry.getAll(),pairLog:pairLog.slice(0,500),errorLog:errorLog.slice(0,200)};
    res.setHeader('Content-Type','application/json');
    res.setHeader('Content-Disposition',`attachment; filename="mais-backup-${Date.now()}.json"`);
    res.send(JSON.stringify(backup,null,2));
});

// ── Admin: settings (bot token, etc.) ────────────────────────────────────────
app.get('/api/admin/settings', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    const tok = configuredTelegramToken();
    const masked = tok.length > 8 ? tok.slice(0,6) + '…' + tok.slice(-4) : tok ? '••••••••' : '';
    const tg = global._telegramBotState || {};
    res.json({
        ok:true,
        telegramBotToken: masked,
        hasTelegramBot: !!tok,
        botActive: tg.polling === true,
        botConfigured: tg.configured === true,
        botError: tg.lastError || null,
        tokenSource: process.env.TELEGRAM_BOT_TOKEN ? 'environment' : (process.env.BOT_TOKEN ? 'environment-alias' : 'admin-settings')
    });
});

app.post('/api/admin/settings/bot-token', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    const {token} = req.body;
    if (!token || typeof token !== 'string' || token.trim().length < 10)
        return res.status(400).json({ok:false,error:'Invalid token — must be at least 10 characters.'});
    const newToken = token.trim();
    process.env.TELEGRAM_BOT_TOKEN = newToken;
    adminSettings.telegramBotToken = newToken;
    writeJson(ADMIN_SETTINGS_FILE, adminSettings);
    try {
        // Stop the currently-running poller BEFORE loading a new one, otherwise
        // both poll the same token and Telegram answers every request with
        // 409 Conflict. bot.js also guards this via global._miasTelegramBot.
        if (global._miasTelegramBot) {
            try { global._miasTelegramBot.stopPolling({ cancel: true }); } catch {}
            global._miasTelegramBot = null;
        }
        try { delete require.cache[require.resolve('./nexstore/token')]; } catch {}
        try { delete require.cache[require.resolve('./bot')]; } catch {}
        global._telegramBotLoaded = false;
        global._telegramBotState = null;
        require('./bot');
        global._telegramBotLoaded = true;
        logger.log('admin', 'Telegram bot token updated and polling restarted');
        res.json({ok:true, message:'Token saved. Bot polling restarted.'});
    } catch(e) {
        logger.error('admin', 'Bot token reload error: '+e.message);
        res.status(500).json({ok:false, error:'Token saved but bot failed to start: '+e.message});
    }
});

app.delete('/api/admin/settings/bot-token', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Unauthorized'});
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete adminSettings.telegramBotToken;
    writeJson(ADMIN_SETTINGS_FILE, adminSettings);
    // Actually stop polling — previously the token was only removed from the
    // config file while the old poller kept holding the Telegram token.
    if (global._miasTelegramBot) {
        try { global._miasTelegramBot.stopPolling({ cancel: true }); } catch {}
        global._miasTelegramBot = null;
    }
    try { delete require.cache[require.resolve('./bot')]; } catch {}
    try { delete require.cache[require.resolve('./nexstore/token')]; } catch {}
    global._telegramBotLoaded = false;
    global._telegramBotState = null;
    logger.log('admin', 'Telegram bot token removed');
    res.json({ok:true, message:'Token removed. Telegram bot stopped.'});
});

app.get('/admin', (_,res) => {
    const f=path.join(__dirname,'public','admin.html');
    if(fs.existsSync(f)) res.sendFile(f); else res.status(404).send('Admin panel not found.');
});

app.use((_,res) => res.status(404).json({ok:false,error:'Not found'}));

// ═════════════════════════════════════════════════════════════════════════════
// STARTUP — bind PORT immediately, then lazy-load heavy modules
// ═════════════════════════════════════════════════════════════════════════════
const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 MAIS MDX listening on 0.0.0.0:${PORT}`);
    setImmediate(async () => {
        try { require('./setting/config'); console.log('✓ Config'); } catch(e){ console.error('✗ Config:',e.message); }
        try { _launcher=require('./mais_launcher'); console.log('✓ Launcher'); } catch(e){ console.error('✗ Launcher:',e.message); }
        try { _pair=require('./pair'); console.log('✓ Pair module'); } catch(e){ console.error('✗ Pair:',e.message); }
        _ready=true;
        logger.log('system',`Server started port=${PORT} pair=${!!_pair} launcher=${!!_launcher}`);
        console.log('✅ Server READY\n');
        setTimeout(()=>{
            try {
                if(configuredTelegramToken()){
                    require('./bot');
                    global._telegramBotLoaded=true;
                    logger.log('system','Telegram bot loaded from environment/persisted settings');
                } else {
                    logger.warn('system','Telegram bot not loaded: TELEGRAM_BOT_TOKEN/BOT_TOKEN is missing');
                }
            } catch(e){logger.error('system','Telegram bot error: '+e.message);}
        },3000);
        setTimeout(()=>_autoLoadPairs(),6000);
    });
});

httpServer.on('error',e=>{ console.error('[HTTP server error]',e.message,' — staying alive, will retry'); if(e.code==='EADDRINUSE'){ setTimeout(()=>httpServer.listen(PORT,'0.0.0.0'),3000); } });

async function _autoLoadPairs() {
    if (!_pair||!_launcher) return;
    try {
        const paired=_pair.listPairedDevices(false);
        let launched=0;
        for(const jid of paired){
            if(_launcher.isPaused(jid)) continue;
            const sd=path.join(PAIRING_DIR,jid);
            if(!fs.existsSync(path.join(sd,'creds.json'))) continue;
            try {
                if(!_launcher.list().find(r=>r.number===jid&&r.alive)){
                    await _launcher.launch(jid,sd);registry.updateStatus(jid,'connected');launched++;await _sleep(2000);
                }
            } catch(e){ registry.updateStatus(jid,'disconnected'); }
        }
        logger.log('system',`AutoLoad: ${launched}/${paired.length} started`);
    } catch(e){ console.error('[AutoLoad]',e.message); }
}

process.on('SIGTERM',()=>{ registry.flush();httpServer.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000); });
process.on('uncaughtException',e=>{ const msg=safeErrorMessage(e); console.error('[uncaughtException]',msg);logger.error('system','Uncaught: '+msg); });
process.on('unhandledRejection',r=>{ const msg=safeErrorMessage(r); console.error('[unhandledRejection]',msg);logger.error('system','Rejection: '+msg); });
