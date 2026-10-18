import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyMigrations,
  assertReadOnlyConnection,
  canonicalJson,
  compareAndSwapBotState,
  createNeonPool,
  derivePersistenceScope,
  readBotState,
  safeDbErrorCode,
  seedBotState,
} from "../mias/neonPersistence.js";

class FakePool {
  constructor() {
    this.queries = [];
    this.state = new Map();
    this.migrations = new Map();
    this.databaseName = "neondb";
  }

  async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ sql: compact, params });

    if (compact.startsWith("SELECT 1 AS ok")) {
      return { rows: [{ ok: 1, database_name: this.databaseName }] };
    }
    if (compact.startsWith("CREATE TABLE IF NOT EXISTS mias_schema_migrations")) {
      return { rows: [] };
    }
    if (compact.startsWith("SELECT checksum FROM mias_schema_migrations")) {
      const checksum = this.migrations.get(params[0]);
      return { rows: checksum ? [{ checksum }] : [] };
    }
    if (compact.startsWith("INSERT INTO mias_schema_migrations")) {
      this.migrations.set(params[0], params[1]);
      return { rows: [] };
    }
    if (compact.startsWith("SELECT payload, revision FROM mias_bot_state")) {
      const row = this.state.get(params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (compact.startsWith("INSERT INTO mias_bot_state")) {
      if (this.state.has(params[0])) return { rows: [] };
      const row = { payload: JSON.parse(params[1]), revision: 1 };
      this.state.set(params[0], row);
      return { rows: [{ ...row }] };
    }
    if (compact.startsWith("UPDATE mias_bot_state")) {
      const row = this.state.get(params[0]);
      if (!row || Number(row.revision) !== Number(params[1])) return { rows: [] };
      row.payload = JSON.parse(params[2]);
      row.revision += 1;
      return { rows: [{ revision: row.revision }] };
    }
    if (compact.startsWith("SELECT pg_advisory_xact_lock")) {
      return { rows: [{}] };
    }
    if (compact === "BEGIN" || compact === "COMMIT" || compact === "ROLLBACK") {
      return { rows: [] };
    }
    if (/^CREATE TABLE IF NOT EXISTS mias_bot_state/.test(compact)) {
      return { rows: [] };
    }
    if (/^CREATE INDEX IF NOT EXISTS mias_bot_state_updated_at_idx/.test(compact)) {
      return { rows: [] };
    }
    if (/^CREATE TABLE IF NOT EXISTS mias_session_auth/.test(compact)) {
      return { rows: [] };
    }
    if (/^CREATE INDEX IF NOT EXISTS mias_session_auth/.test(compact)) {
      return { rows: [] };
    }
    if (/^CREATE TABLE IF NOT EXISTS mias_session_registry/.test(compact)) {
      return { rows: [] };
    }
    if (/^CREATE INDEX IF NOT EXISTS mias_session_registry/.test(compact)) {
      return { rows: [] };
    }
    if (/^CREATE TABLE IF NOT EXISTS mias_bot_selections/.test(compact)) {
      return { rows: [] };
    }

    throw new Error(`Unexpected fake SQL: ${compact}`);
  }

  async connect() {
    return {
      query: (sql, params) => this.query(sql, params),
      release() {},
    };
  }
}

test("Neon pool config uses bounded connections and verified TLS", () => {
  let config;
  class CapturingPool {
    constructor(value) {
      config = value;
    }
  }

  createNeonPool({
    connectionString: "postgresql://localhost/neondb?sslmode=require",
    PoolClass: CapturingPool,
  });

  assert.equal(config.max, 2);
  assert.equal(config.connectionTimeoutMillis, 5000);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.application_name, "mais-mdx");
});

test("missing and invalid DATABASE_URL failures are sanitized", () => {
  assert.throws(() => createNeonPool({ connectionString: "" }), (error) => {
    assert.equal(safeDbErrorCode(error), "DATABASE_URL_MISSING");
    assert.doesNotMatch(error.message, /password|user@|postgresql/i);
    return true;
  });

  assert.throws(() => createNeonPool({ connectionString: "not-a-url" }), (error) => {
    assert.equal(safeDbErrorCode(error), "DATABASE_URL_INVALID");
    return true;
  });
});

test("readiness check issues only SELECT and verifies database name", async () => {
  const pool = new FakePool();
  const result = await assertReadOnlyConnection(pool);
  assert.deepEqual(result, { ok: true, databaseName: "neondb" });
  assert.equal(pool.queries.length, 1);
  assert.match(pool.queries[0].sql, /^SELECT 1 AS ok/);

  pool.databaseName = "other_database";
  await assert.rejects(assertReadOnlyConnection(pool), (error) => {
    assert.equal(safeDbErrorCode(error), "DATABASE_NAME_MISMATCH");
    return true;
  });
});

test("transient read-only probe failures retry a bounded number of times", async () => {
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("hidden"), { code: "ECONNRESET" });
      return { rows: [{ ok: 1, database_name: "neondb" }] };
    },
  };

  await assertReadOnlyConnection(pool, { delay: async () => {} });
  assert.equal(calls, 3);
});

test("scope hashes isolate session directories without storing their raw path", () => {
  const first = derivePersistenceScope({ AUTH_DIR: "/app/nexstore/pairing/15550001" });
  const same = derivePersistenceScope({ AUTH_DIR: "/app/nexstore/pairing/15550001" });
  const other = derivePersistenceScope({ AUTH_DIR: "/app/nexstore/pairing/15550002" });

  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.match(first, /^session_[a-f0-9]{40}$/);
  assert.doesNotMatch(first, /15550001/);
});

test("seed is insert-only and compare-and-swap rejects stale writers", async () => {
  const pool = new FakePool();
  const initial = { settings: { user: { prefix: "." } } };
  const seeded = await seedBotState(pool, "session_a", initial);
  assert.equal(seeded.inserted, true);
  assert.equal(seeded.revision, 1);

  const raced = await seedBotState(pool, "session_a", { settings: {} });
  assert.equal(raced.inserted, false);
  assert.deepEqual(raced.payload, initial);

  const next = { settings: { user: { prefix: "!" } } };
  assert.equal(await compareAndSwapBotState(pool, "session_a", 1, next), 2);
  assert.equal(await compareAndSwapBotState(pool, "session_a", 1, initial), null);
  assert.deepEqual((await readBotState(pool, "session_a")).payload, next);
});

test("versioned migrations are idempotent and additive", async (t) => {
  const pool = new FakePool();
  const appliedFirst = await applyMigrations(pool);
  const appliedAgain = await applyMigrations(pool);
  const sql = fs.readFileSync(
    new URL("../mias/migrations/0001_create_bot_state.sql", import.meta.url),
    "utf8",
  );

  assert.deepEqual(appliedFirst, ["0001", "0002"]);
  assert.deepEqual(appliedAgain, []);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS mias_bot_state/);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE)\b/i);
  assert.equal(pool.migrations.size, 2);
  t.diagnostic(`migration files: ${pool.migrations.size}`);
});

test("canonical JSON ignores object property order but preserves array order", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});
