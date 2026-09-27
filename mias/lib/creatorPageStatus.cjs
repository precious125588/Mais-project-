// =========================================================================
//  creatorPageStatus.cjs — startup diagnostics for the existing
//  creator-page / username configuration. DIAGNOSTICS ONLY.
//
//  The prompt requires: read the EXISTING configuration, never invent a
//  username, and never turn this into an additional anime source.
//
//  The repo has NO "CREATOR_USERNAME" variable. The closest existing,
//  actually-used configuration is OWNER_NUMBER / OWNER_NAME (used by the
//  owner/auth system). This module reports the status of that existing
//  creator/owner identity so the log shows its true state instead of
//  silence. It never fabricates a value: unset → NOT CONFIGURED / INACTIVE.
// =========================================================================
'use strict';

function _cfg() {
  const username =
    process.env.CREATOR_USERNAME ||          // honoured if a deployment sets it
    process.env.OWNER_NAME ||
    process.env.REPL_OWNER ||
    '';
  const number = process.env.OWNER_NUMBER || '';
  return { username: String(username).trim(), number: String(number).trim() };
}

function status() {
  const { username, number } = _cfg();
  if (!username && !number) {
    return { configured: false, active: false, username: '', state: 'INACTIVE' };
  }
  // "configured and active" means a usable creator identity is present.
  if (username) return { configured: true, active: true, username, state: 'ACTIVE' };
  // number present but no display name → configured but name unavailable.
  return { configured: true, active: false, username: '', state: 'OFFLINE' };
}

function statusLines() {
  const s = status();
  const lines = ['👤 CREATOR PAGE'];
  if (!s.configured) {
    lines.push('⚠️ Creator username: NOT CONFIGURED');
    lines.push('🔴 Status: INACTIVE');
  } else if (s.active) {
    lines.push(`✅ Creator username: ${s.username}`);
    lines.push('🟢 Status: ACTIVE');
  } else {
    lines.push(`⚠️ Creator username: ${s.username || 'NOT CONFIGURED'}`);
    lines.push('🔴 Status: OFFLINE');
  }
  return lines;
}

function printCreatorStatus() {
  try { console.log(statusLines().join('\n')); } catch {}
}

module.exports = { status, statusLines, printCreatorStatus };
