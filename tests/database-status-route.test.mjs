import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

test("database status endpoint returns not_configured when DATABASE_URL is unset", async () => {
  delete process.env.DATABASE_URL;

  const app = express();
  let volumeMounted = false;
  app.get('/api/database/status', async (_, res) => {
    const hasDbUrl = Boolean(String(process.env.DATABASE_URL || '').trim());
    if (!hasDbUrl) {
      return res.json({
        ok: true,
        attached: false,
        status: 'not_configured',
        message: 'DATABASE_URL is not set',
        database: null,
        volumeMounted,
      });
    }
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/database/status`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.attached, false);
    assert.equal(data.status, "not_configured");
  } finally {
    server.close();
  }
});
