import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizePostgresConnectionString } = require("../mias/lib/pgConnection.cjs");

test("legacy sslmode=prefer is removed while explicit TLS remains the pool's responsibility", () => {
  const normalized = new URL(normalizePostgresConnectionString(
    "postgresql://db-user:db-pass@example.neon.tech/mias?sslmode=prefer&application_name=mais",
  ));
  assert.equal(normalized.searchParams.has("sslmode"), false);
  assert.equal(normalized.searchParams.get("application_name"), "mais");
  assert.equal(normalized.hostname, "example.neon.tech");
});

test("non-deprecated sslmode values and unrelated URLs are unchanged", () => {
  const verifyFull = "postgresql://db-user:db-pass@example.neon.tech/mias?sslmode=verify-full";
  assert.equal(normalizePostgresConnectionString(verifyFull), verifyFull);
  assert.equal(normalizePostgresConnectionString("https://example.com/?sslmode=prefer"), "https://example.com/?sslmode=prefer");
});
