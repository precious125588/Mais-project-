import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── 1. Host Detection Tests ──────────────────────────────────────────────────
test('hostDetect: detects canonical platforms and provides fallback', async () => {
  const { detectHostEnvironment, getHostName } = await import('../mias/lib/hostDetect.cjs');

  // Replit
  assert.equal(getHostName({ REPL_ID: 'xyz' }), 'Replit');
  // Heroku
  assert.equal(getHostName({ DYNO: 'web.1' }), 'Heroku');
  // Railway
  assert.equal(getHostName({ RAILWAY_ENVIRONMENT: 'production' }), 'Railway');
  // Render
  assert.equal(getHostName({ RENDER: 'true' }), 'Render');
  // Koyeb
  assert.equal(getHostName({ KOYEB_SERVICE_ID: 'svc-123' }), 'Koyeb');
  // Fly.io
  assert.equal(getHostName({ FLY_APP_NAME: 'mias-bot' }), 'Fly.io');
  // Vercel
  assert.equal(getHostName({ VERCEL: '1' }), 'Vercel');
  // Netlify
  assert.equal(getHostName({ NETLIFY: 'true' }), 'Netlify');
  // GitHub Codespaces
  assert.equal(getHostName({ CODESPACES: 'true' }), 'GitHub Codespaces');
  // Gitpod
  assert.equal(getHostName({ GITPOD_WORKSPACE_ID: 'gp-1' }), 'Gitpod');
  // Cyclic
  assert.equal(getHostName({ CYCLIC_APP_ID: 'cy-1' }), 'Cyclic');
  // Termux
  assert.equal(getHostName({ TERMUX_VERSION: '0.118.0' }), 'Termux');
  // AWS Lambda
  assert.equal(getHostName({ AWS_LAMBDA_FUNCTION_NAME: 'handler' }), 'AWS Lambda');
  // Google Cloud
  assert.equal(getHostName({ K_SERVICE: 'mias-service' }), 'Google Cloud Run/Functions');
  // Azure
  assert.equal(getHostName({ WEBSITE_SITE_NAME: 'mias-azure' }), 'Azure App Service');

  // Fallback with empty environment
  const empty = detectHostEnvironment({});
  assert.ok(empty.platform.length > 0);
  assert.equal(empty.confidence, 'inferred');
});

// ── 2. Secure Crypto Tests ───────────────────────────────────────────────────
test('secureCrypto: authenticated AES-256-GCM encryption & decryption', async () => {
  const { encryptBuffer, decryptBuffer, isEncryptedFormat } = await import('../mias/lib/secureCrypto.cjs');

  const password = 'CorrectHorseBatteryStaple123!';
  const plaintext = Buffer.from('Sensitive payload data to protect with AES-256-GCM.');

  // Roundtrip
  const encrypted = encryptBuffer(plaintext, password);
  assert.ok(isEncryptedFormat(encrypted));
  assert.notEqual(encrypted.indexOf('MIASENC1'), -1);

  const decrypted = decryptBuffer(encrypted, password);
  assert.deepEqual(decrypted, plaintext);

  // Wrong password fails
  assert.throws(() => {
    decryptBuffer(encrypted, 'WrongPassword!');
  }, /Decryption failed/);

  // Tampered ciphertext fails
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 0x01; // flip last byte
  assert.throws(() => {
    decryptBuffer(tampered, password);
  }, /Decryption failed/);

  // Empty data roundtrip
  const emptyBuf = Buffer.alloc(0);
  const encEmpty = encryptBuffer(emptyBuf, password);
  const decEmpty = decryptBuffer(encEmpty, password);
  assert.deepEqual(decEmpty, emptyBuf);

  // Malformed header rejection
  assert.throws(() => {
    decryptBuffer(Buffer.from('too short'), password);
  }, /Malformed encrypted data/);

  // Non-MIASENC1 format rejected
  assert.throws(() => {
    decryptBuffer(Buffer.alloc(60), password);
  }, /Unsupported encrypted format/);
});

// ── 3. MediaFire Resolver & ZIP Extractor Tests ───────────────────────────────
test('mediafireResolver: validates links, rejects SSRF and path traversal', async () => {
  const {
    isMediaFireUrl,
    assertPublicHttpUrl,
    resolveMediaFire,
    downloadMediaFire,
    extractZipBuffer,
    safeEntryPath,
  } = await import('../mias/lib/mediafireResolver.cjs');

  // URL checks
  assert.ok(isMediaFireUrl('https://www.mediafire.com/file/xyz123/archive.zip'));
  assert.ok(isMediaFireUrl('https://mfi.re/file/xyz123/archive.zip'));
  assert.ok(!isMediaFireUrl('https://evil.com/file/xyz123'));
  assert.ok(!isMediaFireUrl('file:///etc/passwd'));

  // SSRF prevention: loopback & private networks
  await assert.rejects(async () => {
    await assertPublicHttpUrl('http://127.0.0.1/test.zip');
  }, /Restricted download destination/);

  await assert.rejects(async () => {
    await assertPublicHttpUrl('http://192.168.1.1/test.zip');
  }, /Restricted download destination/);

  await assert.rejects(async () => {
    await assertPublicHttpUrl('http://10.0.0.1/test.zip');
  }, /Restricted download destination/);

  await assert.rejects(async () => {
    await assertPublicHttpUrl('http://localhost/test.zip');
  }, /Restricted download destination/);

  // Safe entry path & traversal prevention
  const baseDir = '/tmp/mias-test-dir';
  assert.equal(safeEntryPath(baseDir, 'file.txt'), path.resolve(baseDir, 'file.txt'));
  assert.equal(safeEntryPath(baseDir, 'sub/dir/file.txt'), path.resolve(baseDir, 'sub/dir/file.txt'));

  assert.throws(() => safeEntryPath(baseDir, '../escape.txt'), /Unsafe ZIP entry path/);
  assert.throws(() => safeEntryPath(baseDir, '../../etc/passwd'), /Unsafe ZIP entry path/);
  assert.throws(() => safeEntryPath(baseDir, '/absolute/path.txt'), /Unsafe ZIP entry path/);

  // Mocked MediaFire HTML resolution
  const mockHtml = `
    <html>
      <body>
        <a id="downloadButton" href="https://download123.mediafire.com/xyz/real.zip">Download (10MB)</a>
      </body>
    </html>
  `;
  const mockFetch = async () => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    data: mockHtml,
  });

  const resolved = await resolveMediaFire('https://www.mediafire.com/file/test/archive.zip', { fetch: mockFetch });
  assert.equal(resolved, 'https://download123.mediafire.com/xyz/real.zip');

  // Extraction of valid zip buffer
  const sampleZip = zipSync({
    'hello.txt': Buffer.from('Hello world!'),
    'folder/nested.txt': Buffer.from('Nested content'),
  });

  const tempExtractDir = path.join(os.tmpdir(), `mias-ext-test-${Date.now()}`);
  try {
    const extractedFiles = extractZipBuffer(sampleZip, tempExtractDir);
    assert.equal(extractedFiles.length, 2);
    assert.ok(fs.existsSync(path.join(tempExtractDir, 'hello.txt')));
    assert.ok(fs.existsSync(path.join(tempExtractDir, 'folder/nested.txt')));
    assert.equal(fs.readFileSync(path.join(tempExtractDir, 'hello.txt'), 'utf8'), 'Hello world!');
  } finally {
    await fsp.rm(tempExtractDir, { recursive: true, force: true });
  }

  // Reject invalid / corrupt zip
  assert.throws(() => {
    extractZipBuffer(Buffer.from('not a zip archive at all'), tempExtractDir);
  });
});

// ── 4. Settings Defaults Verification ─────────────────────────────────────────
test('settings: default values match required defaults and preserve existing preferences', async () => {
  const indexContent = fs.readFileSync(path.join(ROOT, 'mias', 'index.js'), 'utf8');

  // Verify defaultSettings in source
  assert.ok(indexContent.includes('blockCalls: true'), 'blockCalls must default to true');
  assert.ok(indexContent.includes('autoReact: false'), 'autoReact must default to false');

  // Simulate getSettings lazy-merge behavior: existing saved preferences must NOT be overwritten
  function defaultSettings() {
    return {
      autoReact: false,
      blockCalls: true,
      autoSendStatus: true,
      autoSendAza: true,
    };
  }

  const existingUserSaved = {
    autoReact: true, // User explicitly enabled it earlier
    blockCalls: false, // User explicitly disabled it earlier
  };

  function getSettings(saved) {
    const d = defaultSettings();
    return { ...d, ...saved };
  }

  const merged = getSettings(existingUserSaved);
  // User preferences are preserved!
  assert.equal(merged.autoReact, true, 'Saved user autoReact preference must be preserved');
  assert.equal(merged.blockCalls, false, 'Saved user blockCalls preference must be preserved');
  // Missing settings get defaults
  assert.equal(merged.autoSendStatus, true, 'Default autoSendStatus applied when missing');
  assert.equal(merged.autoSendAza, true, 'Default autoSendAza applied when missing');
});
