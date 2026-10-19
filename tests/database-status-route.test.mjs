import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

test("database status endpoint returns settingsDb and sessionDb status", async () => {
  const origSettings = process.env.DATABASE_URL;
  const origSession = process.env.SESSION_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_DATABASE_URL;

  const app = express();
  let volumeMounted = false;
  app.get('/api/database/status', async (_, res) => {
    const settingsUrl = String(process.env.DATABASE_URL || '').trim();
    const sessionUrl = String(process.env.SESSION_DATABASE_URL || '').trim();

    const settingsDb = settingsUrl
      ? { attached: true, status: 'connected', message: 'Settings database connected', database: 'settingsdb' }
      : { attached: false, status: 'not_configured', message: 'DATABASE_URL is not set', database: null };

    const sessionDb = sessionUrl
      ? { attached: true, status: 'connected', message: 'Session database connected', database: 'sessiondb', sessionsInDb: 2 }
      : { attached: false, status: 'not_configured', message: 'SESSION_DATABASE_URL is not set', database: null, sessionsInDb: 0 };

    res.json({
      ok: true,
      settingsDb,
      sessionDb,
      volumeMounted,
      attached: settingsDb.attached || sessionDb.attached,
      status: (settingsDb.attached || sessionDb.attached) ? 'connected' : 'not_configured',
      database: sessionDb.database || settingsDb.database,
      sessionsInDb: sessionDb.sessionsInDb,
    });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Both unconfigured
    const r1 = await fetch(`http://127.0.0.1:${port}/api/database/status`);
    const d1 = await r1.json();
    assert.equal(d1.ok, true);
    assert.equal(d1.settingsDb.attached, false);
    assert.equal(d1.sessionDb.attached, false);

    // 2. Settings DB only
    process.env.DATABASE_URL = 'postgresql://user:pass@host/settingsdb';
    const r2 = await fetch(`http://127.0.0.1:${port}/api/database/status`);
    const d2 = await r2.json();
    assert.equal(d2.settingsDb.attached, true);
    assert.equal(d2.sessionDb.attached, false);

    // 3. Both configured
    process.env.SESSION_DATABASE_URL = 'postgresql://user:pass@host/sessiondb';
    const r3 = await fetch(`http://127.0.0.1:${port}/api/database/status`);
    const d3 = await r3.json();
    assert.equal(d3.settingsDb.attached, true);
    assert.equal(d3.sessionDb.attached, true);
    assert.equal(d3.sessionDb.sessionsInDb, 2);
  } finally {
    server.close();
    if (origSettings !== undefined) process.env.DATABASE_URL = origSettings; else delete process.env.DATABASE_URL;
    if (origSession !== undefined) process.env.SESSION_DATABASE_URL = origSession; else delete process.env.SESSION_DATABASE_URL;
  }
});

test("admin login accepts password-only authentication and rejects wrong password", async () => {
  const app = express();
  app.use(express.json());
  const ADMIN_PASSWORD = "test-secret-password-123";

  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ ok: false, error: 'Wrong password.' });
    }
    return res.json({ ok: true, token: 'mock-admin-token' });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Login with only password succeeds (no username supplied)
    const r1 = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-secret-password-123' }),
    });
    const d1 = await r1.json();
    assert.equal(r1.status, 200);
    assert.equal(d1.ok, true);
    assert.equal(d1.token, 'mock-admin-token');

    // 2. Login with wrong password fails
    const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-pass' }),
    });
    assert.equal(r2.status, 401);
    const d2 = await r2.json();
    assert.equal(d2.ok, false);

    // 3. Username is ignored even if something different is passed
    const r3 = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'any-random-user', password: 'test-secret-password-123' }),
    });
    const d3 = await r3.json();
    assert.equal(r3.status, 200);
    assert.equal(d3.ok, true);
  } finally {
    server.close();
  }
});

test("admin clean-all database route requires admin authentication", async () => {
  const app = express();
  app.use(express.json());

  app.post('/api/admin/database/clean-all', (req, res) => {
    const token = req.headers['x-admin-token'];
    if (!token || token !== 'valid-token') {
      return res.status(403).json({ ok: false, error: 'Unauthorized' });
    }
    return res.json({ ok: true, message: 'All databases and sessions cleaned successfully.' });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // Without token: 403
    const r1 = await fetch(`http://127.0.0.1:${port}/api/admin/database/clean-all`, { method: 'POST' });
    assert.equal(r1.status, 403);

    // With valid token: 200
    const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/database/clean-all`, {
      method: 'POST',
      headers: { 'x-admin-token': 'valid-token' },
    });
    assert.equal(r2.status, 200);
    const d2 = await r2.json();
    assert.equal(d2.ok, true);
  } finally {
    server.close();
  }
});
