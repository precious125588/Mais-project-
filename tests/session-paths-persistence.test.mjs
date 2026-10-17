import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SESSION_PATHS_MODULE = new URL("../sessionPaths.js", import.meta.url).pathname;

function runNode(script, env) {
  return spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
}

test("Railway mount path is the shared data and session root", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "railway-volume-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const result = runNode(
    `const paths = require(${JSON.stringify(SESSION_PATHS_MODULE)});
     console.log(JSON.stringify({
       mounted: paths.isVolumeMounted(),
       root: paths.nexstoreRoot(),
       sessions: paths.resolveSessionRoot(),
     }));`,
    { RAILWAY_VOLUME_MOUNT_PATH: tempRoot, SESSION_DIR: "" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(output.mounted, true);
  assert.equal(output.root, tempRoot);
  assert.equal(output.sessions, path.join(tempRoot, "pairing"));
});

test("explicit per-service session directory still takes precedence", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "railway-volume-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const sessionRoot = path.join(tempRoot, "custom-pairing");

  const result = runNode(
    `const paths = require(${JSON.stringify(SESSION_PATHS_MODULE)});
     console.log(paths.resolveSessionRoot());`,
    { RAILWAY_VOLUME_MOUNT_PATH: tempRoot, SESSION_DIR: sessionRoot },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), sessionRoot);
});
