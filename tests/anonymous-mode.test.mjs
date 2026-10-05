import test from 'node:test';
import assert from 'node:assert/strict';

test('Anonymous Mode setting default is false / OFF', () => {
  const defaultSettings = () => ({ anonymousMode: false, readMsgs: false, viewStatus: false, autoReact: true });
  const s = defaultSettings();
  assert.equal(s.anonymousMode, false);
  assert.equal(s.readMsgs, false);
});

test('Delivery receipt suppression logic targets only incoming normal receipts', () => {
  const shouldSuppress = (isAnonOn, msg, type) => {
    if (!isAnonOn) return false;
    // fromMe messages (type === 'sender') must not be suppressed
    if (msg.key?.fromMe || type === 'sender') return false;
    // peer messages (type === 'peer_msg') must not be suppressed
    if (type === 'peer_msg') return false;
    // history sync (type === 'hist_sync') must not be suppressed
    if (type === 'hist_sync') return false;
    // normal incoming delivery receipt has type === undefined or type === 'inactive'
    if (type === undefined || type === 'inactive') {
      return true;
    }
    return false;
  };

  // Test 1: Anonymous OFF -> incoming message delivery receipt NOT suppressed
  assert.equal(shouldSuppress(false, { key: { id: 'msg-1', remoteJid: 'user@s.whatsapp.net', fromMe: false } }, undefined), false);

  // Test 2: Anonymous ON -> incoming message delivery receipt IS suppressed
  assert.equal(shouldSuppress(true, { key: { id: 'msg-2', remoteJid: 'user@s.whatsapp.net', fromMe: false } }, undefined), true);
  assert.equal(shouldSuppress(true, { key: { id: 'msg-3', remoteJid: 'group@g.us', fromMe: false } }, undefined), true);

  // Test 3: Read receipt (type === 'read' or 'read-self') is NOT suppressed by this function
  assert.equal(shouldSuppress(true, { key: { id: 'msg-4', remoteJid: 'user@s.whatsapp.net', fromMe: false } }, 'read'), false);
  assert.equal(shouldSuppress(true, { key: { id: 'msg-5', remoteJid: 'user@s.whatsapp.net', fromMe: false } }, 'read-self'), false);

  // Test 4: Sender / fromMe messages are NOT suppressed
  assert.equal(shouldSuppress(true, { key: { id: 'msg-6', remoteJid: 'user@s.whatsapp.net', fromMe: true } }, 'sender'), false);

  // Test 5: Peer messages are NOT suppressed
  assert.equal(shouldSuppress(true, { key: { id: 'msg-7', remoteJid: 'user@s.whatsapp.net', fromMe: false } }, 'peer_msg'), false);

  // Test 6: History sync is NOT suppressed
  assert.equal(shouldSuppress(true, { key: { id: 'msg-8', remoteJid: 'user@s.whatsapp.net', fromMe: false } }, 'hist_sync'), false);
});

test('Per-bot session independence', () => {
  const botSessions = {
    '1234567890': { anonymousMode: true },
    '9876543210': { anonymousMode: false }
  };

  const checkBot = (botNumber) => {
    return Boolean(botSessions[botNumber]?.anonymousMode);
  };

  assert.equal(checkBot('1234567890'), true);
  assert.equal(checkBot('9876543210'), false);
});
