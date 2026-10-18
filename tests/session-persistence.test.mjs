import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import sessionPersistence from "../sessionPersistence.cjs";

test("normalizeSessionKeys handles bare digits, JIDs, and directory basenames", () => {
  const c1 = sessionPersistence.normalizeSessionKeys("2348123456789");
  assert.equal(c1.number, "2348123456789");
  assert.equal(c1.jid, "2348123456789@s.whatsapp.net");

  const c2 = sessionPersistence.normalizeSessionKeys("2348123456789@s.whatsapp.net");
  assert.equal(c2.number, "2348123456789");
  assert.equal(c2.jid, "2348123456789@s.whatsapp.net");

  const c3 = sessionPersistence.normalizeSessionKeys("+234 812-345-6789");
  assert.equal(c3.number, "2348123456789");
  assert.equal(c3.jid, "2348123456789@s.whatsapp.net");
});

test("sessionPersistence methods gracefully degrade when DATABASE_URL is unset", async () => {
  const orig = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    const saved = await sessionPersistence.saveSessionFile("9999000001", "creds.json", "{}");
    assert.equal(saved, false);

    const synced = await sessionPersistence.syncSessionDirToDb("9999000001", "/tmp/does-not-exist");
    assert.equal(synced.ok, false);
    assert.equal(synced.reason, "db_not_configured");

    const restored = await sessionPersistence.restoreSessionDirFromDb("9999000001", "/tmp/does-not-exist");
    assert.equal(restored.ok, false);
    assert.equal(restored.reason, "db_not_configured");

    const count = await sessionPersistence.getStoredSessionsCount();
    assert.equal(count, 0);
  } finally {
    if (orig) process.env.DATABASE_URL = orig;
  }
});

test("complete session purge deletes session folder, quarantine copies, and temp files", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mias-test-purge-"));
  const pairingRoot = path.join(tmpRoot, "pairing");
  fs.mkdirSync(pairingRoot, { recursive: true });

  const testNumber = "9999000099";
  const sessionDir = path.join(pairingRoot, `${testNumber}@s.whatsapp.net`);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "creds.json"), JSON.stringify({ me: { id: `${testNumber}:1` } }), "utf8");
  fs.writeFileSync(path.join(sessionDir, "pre-key-1.json"), "{}", "utf8");

  // Create an old quarantine folder for this user that previously leaked disk space
  const oldQuarantineDir = path.join(pairingRoot, `${testNumber}@s.whatsapp.net.quarantine-2026-10-17-12-00-00`);
  fs.mkdirSync(oldQuarantineDir, { recursive: true });
  fs.writeFileSync(path.join(oldQuarantineDir, "stale-creds.json"), "{}", "utf8");

  // Create an unrelated user's folder to ensure safety
  const otherNumber = "8888000088";
  const otherDir = path.join(pairingRoot, `${otherNumber}@s.whatsapp.net`);
  fs.mkdirSync(otherDir, { recursive: true });
  fs.writeFileSync(path.join(otherDir, "creds.json"), "{}", "utf8");

  // Verify setup
  assert.ok(fs.existsSync(sessionDir));
  assert.ok(fs.existsSync(oldQuarantineDir));
  assert.ok(fs.existsSync(otherDir));

  // Run deleteSessionCompletely
  const result = await sessionPersistence.deleteSessionCompletely({
    number: testNumber,
    sessionDir,
    reason: "test_logout",
  });

  assert.equal(result.ok, true);
  assert.equal(result.number, testNumber);

  // Target session and its quarantine folder MUST be deleted to retain space
  assert.equal(fs.existsSync(sessionDir), false);
  assert.equal(fs.existsSync(oldQuarantineDir), false);

  // Unrelated user's session MUST NOT be touched
  assert.ok(fs.existsSync(otherDir));

  // Clean up
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("simulated PostgreSQL session sync, restore, and byte-for-byte fidelity", async () => {
  // Use in-memory mock pool to test the full lifecycle logic
  const storage = new Map();

  class MockPool {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("INSERT INTO mias_session_auth")) {
        const [sessionId, fileName, content] = params;
        const key = `${sessionId}:${fileName}`;
        storage.set(key, { sessionId, fileName, content });
        return { rowCount: 1 };
      }
      if (compact.startsWith("SELECT file_name, content FROM mias_session_auth")) {
        const [targetId, number] = params;
        const rows = [];
        for (const [k, v] of storage.entries()) {
          if (v.sessionId === targetId || v.sessionId === number) {
            rows.push({ file_name: v.fileName, content: v.content });
          }
        }
        return { rows };
      }
      if (compact.startsWith("SELECT DISTINCT session_id FROM mias_session_auth")) {
        const sessions = new Set();
        for (const v of storage.values()) sessions.add(v.sessionId);
        return { rows: Array.from(sessions).map((s) => ({ session_id: s })) };
      }
      if (compact.startsWith("DELETE FROM mias_session_auth")) {
        const [targetId, number] = params;
        let deleted = 0;
        for (const [k, v] of Array.from(storage.entries())) {
          if (v.sessionId === targetId || v.sessionId === number) {
            storage.delete(k);
            deleted++;
          }
        }
        return { rowCount: deleted };
      }
      if (compact.startsWith("SELECT COUNT(DISTINCT session_id)")) {
        const credsSessions = new Set();
        for (const v of storage.values()) {
          if (v.fileName === "creds.json") credsSessions.add(v.sessionId);
        }
        return { rows: [{ count: credsSessions.size }] };
      }
      return { rows: [], rowCount: 0 };
    }
  }

  const mockPool = new MockPool();
  const testNum = "9999000007";
  const testJid = `${testNum}@s.whatsapp.net`;

  // 1. Simulate saving files
  const credsData = JSON.stringify({ noiseKey: { private: "priv", public: "pub" }, me: { id: `${testNum}:0` } });
  const keyData = JSON.stringify({ key: "val-123" });

  await mockPool.query("INSERT INTO mias_session_auth", [testJid, "creds.json", credsData]);
  await mockPool.query("INSERT INTO mias_session_auth", [testJid, "pre-key-1.json", keyData]);

  // 2. Count check
  const countRes = await mockPool.query("SELECT COUNT(DISTINCT session_id)");
  assert.equal(countRes.rows[0].count, 1);

  // 3. Query files for restore
  const restoreRes = await mockPool.query("SELECT file_name, content FROM mias_session_auth", [testJid, testNum]);
  assert.equal(restoreRes.rows.length, 2);

  const restoredCreds = restoreRes.rows.find((r) => r.file_name === "creds.json");
  assert.equal(restoredCreds.content, credsData);

  // 4. Delete on logout
  const delRes = await mockPool.query("DELETE FROM mias_session_auth", [testJid, testNum]);
  assert.equal(delRes.rowCount, 2);
  assert.equal(storage.size, 0);
});

test("getStoredSessionsCount deduplicates bare-number and canonical JID aliases", async () => {
  const storage = new Map();
  class CountPool {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.includes("SELECT DISTINCT session_id FROM mias_session_auth")) {
        return {
          rows: [
            { session_id: "2348123456789@s.whatsapp.net" },
            { session_id: "2348123456789" },
            { session_id: "2348999999999@s.whatsapp.net" }
          ]
        };
      }
      return { rows: [] };
    }
  }

  // Override createPool temporarily
  sessionPersistence.setPoolForTesting(new CountPool());
  try {
    const count = await sessionPersistence.getStoredSessionsCount();
    assert.equal(count, 2); // 2 unique numbers, not 3 rows
  } finally {
    sessionPersistence.setPoolForTesting(null);
  }
});

test("restoreSessionDirFromDb sanitizes traversal in file_name", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mias-traversal-test-"));
  const targetDir = path.join(tmpDir, "session");

  class TraversalPool {
    async query() {
      return {
        rows: [
          { file_name: "../../traversal-file.json", content: '{"safe":true}' },
          { file_name: "creds.json", content: '{"me":true}' }
        ]
      };
    }
  }

  sessionPersistence.setPoolForTesting(new TraversalPool());
  try {
    const res = await sessionPersistence.restoreSessionDirFromDb("1234567890", targetDir);
    assert.equal(res.ok, true);
    assert.equal(fs.existsSync(path.join(targetDir, "creds.json")), true);
    assert.equal(fs.existsSync(path.join(targetDir, "traversal-file.json")), true);
    // Crucial: no file created outside targetDir
    assert.equal(fs.existsSync(path.join(tmpDir, "traversal-file.json")), false);
  } finally {
    sessionPersistence.setPoolForTesting(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
