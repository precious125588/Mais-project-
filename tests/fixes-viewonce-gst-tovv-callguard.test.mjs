import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../mias/index.js', import.meta.url), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `missing marker: ${startMarker.slice(0, 60)}`);
  const b = endMarker ? src.indexOf(endMarker, a + startMarker.length) : a + 12000;
  assert.ok(b > a, `missing end marker: ${endMarker}`);
  return src.slice(a, b);
}

// ── Anti-ViewOnce ─────────────────────────────────────────────────────────
test('Anti-ViewOnce: capture runs on the raw message before normalizeMessage strips the envelope', () => {
  const capture = src.indexOf('const __voPayload = __extractViewOncePayload(msg.message);');
  const normalize = src.indexOf('try { normalizeMessage(msg); } catch {}');
  assert.ok(capture > 0, 'raw capture call present');
  assert.ok(normalize > 0 && capture < normalize, 'capture happens before normalizeMessage');
});

test('Anti-ViewOnce: handler takes the explicit payload and dedupes by message id', () => {
  assert.match(src, /async function handleViewOnce\(sock, msg, voPayload = null\)/);
  assert.match(src, /let vo = voPayload \|\| msg\.message;/);
  assert.match(src, /globalThis\.__voCapturedIds/);
});

test('Anti-ViewOnce: bot-sent view-once messages are tracked so they are never captured back', () => {
  assert.match(src, /async function __voTrackSend\(pending\)/);
  const tracked = (src.match(/await __voTrackSend\(sock\.sendMessage\(/g) || []).length;
  assert.ok(tracked >= 5, `expected >=5 tracked sends, got ${tracked}`);
});

test('Anti-ViewOnce: capture failures are reported to the owner', () => {
  const block = sliceBetween('console.error("[Anti-ViewOnce Error]"', 'function rememberMessage(msg)');
  assert.match(block, /couldn't capture that view-once media/);
});

test('Anti-ViewOnce: payload detection handles every wrapper shape (behavioral)', () => {
  const code = sliceBetween('const __VO_MEDIA_KEYS', '// Remember ids of view-once');
  const ctx = {};
  new Function('ctx', code + '\nctx.f = __extractViewOncePayload;')(ctx);
  const img = { url: 'u', mediaKey: 'k' };
  assert.ok(ctx.f({ viewOnceMessage: { message: { imageMessage: img } } }).imageMessage);
  assert.ok(ctx.f({ viewOnceMessageV2: { message: { videoMessage: img } } }).videoMessage);
  assert.ok(ctx.f({ ephemeralMessage: { message: { viewOnceMessageV2Extension: { message: { audioMessage: img } } } } }).audioMessage);
  assert.ok(ctx.f({ imageMessage: { ...img, viewOnce: true } }).imageMessage);
  assert.equal(ctx.f({ imageMessage: img }), null, 'normal media is not view-once');
  assert.equal(ctx.f({ conversation: 'hi' }), null);
  assert.equal(ctx.f({ viewOnceMessage: { message: { interactiveMessage: { header: { imageMessage: img } } } } }), null, 'bot cards are not view-once media');
});

// ── Call guard ────────────────────────────────────────────────────────────
test('Call guard: report shows only the caller name (no number in the name line)', () => {
  assert.match(src, /const _callerLabel = \(_callerName && isMeaningfulName\(_callerName\)\) \? _callerName : `\+\$\{_callerNum\}`;/);
  assert.match(src, /👤 Caller: \$\{_callerLabel\}/);
});

// ── TikTok error repeats ──────────────────────────────────────────────────
test('TikTok HD error: identical error is never sent twice (no time window)', () => {
  const block = sliceBetween('const _ttErrMap = (globalThis.__ttErrDedupe ||= new Map());', 'await forceReaction(sock, msg, "❌");');
  assert.match(block, /if \(!_ttErrMap\.has\(_ttErrKey\)\)/);
  assert.doesNotMatch(block, /60000/);
});

// ── gst text ──────────────────────────────────────────────────────────────
test('gst: quoted text is posted as a group text status via groupStatusMessageV2', () => {
  const block = sliceBetween('const __gstV23 = async (sock, msg, args) => {', '    for (const n of ["gst", "gstatus", "groupstatus"]) {\n      const e = commands.get(n)');
  assert.match(block, /groupStatusMessageV2/);
  assert.match(block, /There is no text to post/);
  assert.match(src, /m\.buttonsMessage\?\.contentText/);
});

// ── tovv ──────────────────────────────────────────────────────────────────
test('tovv: bare image/video with .tovv caption works, and every failure reacts ❌', () => {
  const block = sliceBetween('cmd(["tovv"], {', 'ADDCASE / DROPCASE');
  assert.match(block, /_tvFromDirect = true/);
  assert.match(block, /__findMediaInMsg\(msg\.message\)/);
  const reacts = (block.match(/await react\(sock, msg, "❌"\)/g) || []).length;
  assert.ok(reacts >= 3, `expected ❌ reactions on failures, got ${reacts}`);
});

test('tovv: media finder reads wrapped settings-card shapes (behavioral)', () => {
  const code = sliceBetween('const __MEDIA_KEYS = ["imageMessage"', 'globalThis.__findMediaInMsg = __findMediaInMsg;');
  const ctx = {};
  new Function('ctx', code + '\nctx.f = __findMediaInMsg;')(ctx);
  const img = { url: 'u', mediaKey: 'k' };
  assert.equal(ctx.f({ imageMessage: img }).kind, 'image');
  assert.equal(ctx.f({ interactiveMessage: { header: { imageMessage: img } } }).kind, 'image');
  assert.equal(ctx.f({ buttonsMessage: { imageMessage: img } }).kind, 'image');
  assert.equal(ctx.f({ viewOnceMessage: { message: { interactiveMessage: { header: { imageMessage: img } } } } }).kind, 'image');
  assert.equal(ctx.f({ templateMessage: { hydratedTemplate: { imageMessage: img } } }).kind, 'image');
  assert.equal(ctx.f({ extendedTextMessage: { text: 'hi' } }), null);
});
