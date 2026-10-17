import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATABASE_MODULE = new URL("../mias/database.js", import.meta.url).href;

function runNode(script, env) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15_000,
  });
}

test("direct startup stores settings and sudo on the mounted volume across processes", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mias-persistence-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const volumeRoot = path.join(tempRoot, "volume");
  fs.mkdirSync(volumeRoot);

  const env = {
    AUTH_DIR: "",
    RAILWAY_VOLUME_MOUNT_PATH: volumeRoot,
  };
  const save = runNode(
    `import { DB_DIR, loadAllData, saveAllData } from ${JSON.stringify(DATABASE_MODULE)};
     const data = loadAllData();
     data.settings.set("restart-check", { persisted: true });
     data.sudo.add("test-user");
     saveAllData(data);
     console.log(JSON.stringify({ dbDir: DB_DIR }));`,
    env,
  );
  assert.equal(save.status, 0, save.stderr || save.stdout);
  const resultLine = save.stdout.trim().split(/\r?\n/).find((line) => line.startsWith("{"));
  assert.ok(resultLine, save.stdout);
  assert.equal(JSON.parse(resultLine).dbDir, path.join(volumeRoot, "database"));

  const reload = runNode(
    `import { loadAllData } from ${JSON.stringify(DATABASE_MODULE)};
     const data = loadAllData();
     if (data.settings.get("restart-check")?.persisted !== true || !data.sudo.has("test-user")) process.exit(1);
     console.log("RESTART_PERSISTENCE_OK");`,
    env,
  );
  assert.equal(reload.status, 0, reload.stderr || reload.stdout);
  assert.match(reload.stdout, /RESTART_PERSISTENCE_OK/);
});

test("an explicit per-bot AUTH_DIR takes precedence over the shared volume fallback", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mias-auth-dir-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const authDir = path.join(tempRoot, "bot-session");
  const volumeRoot = path.join(tempRoot, "volume");
  fs.mkdirSync(volumeRoot);

  const result = runNode(
    `import { DB_DIR } from ${JSON.stringify(DATABASE_MODULE)};
     console.log(JSON.stringify({ dbDir: DB_DIR }));`,
    { AUTH_DIR: authDir, RAILWAY_VOLUME_MOUNT_PATH: volumeRoot },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const resultLine = result.stdout.trim().split(/\r?\n/).find((line) => line.startsWith("{"));
  assert.ok(resultLine, result.stdout);
  assert.equal(JSON.parse(resultLine).dbDir, path.join(authDir, "database"));
});

test("legacy migration copies only missing JSON files and never overwrites volume data", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mias-legacy-migration-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const sourceDir = path.join(tempRoot, "legacy");
  const targetDir = path.join(tempRoot, "persistent");
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(sourceDir, "sudo.json"), '["old-user"]');
  fs.writeFileSync(path.join(sourceDir, "settings.json"), '{"source":"legacy"}');
  fs.writeFileSync(path.join(targetDir, "settings.json"), '{"source":"volume"}');
  fs.writeFileSync(path.join(sourceDir, "notes.txt"), "not a database store");

  const { migrateLegacyDatabase } = await import(DATABASE_MODULE);
  assert.equal(migrateLegacyDatabase(sourceDir, targetDir), 1);
  assert.equal(fs.readFileSync(path.join(targetDir, "sudo.json"), "utf8"), '["old-user"]');
  assert.equal(fs.readFileSync(path.join(targetDir, "settings.json"), "utf8"), '{"source":"volume"}');
  assert.equal(fs.existsSync(path.join(targetDir, "notes.txt")), false);
});
