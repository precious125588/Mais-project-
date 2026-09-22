#!/bin/bash
set -e
cd "$(dirname "$0")"

# ── Install main (root) dependencies ────────────────────────────────────────
if [ ! -d node_modules ] || [ ! -d node_modules/chalk ]; then
  echo "[MAIS] Installing main dependencies..."
  bash scripts/robust-install.sh .
fi

# ── Install mias dependencies ────────────────────────────────────────────────
# Each workspace has its own .npmrc (legacy-peer-deps=true). npm does NOT read
# the parent folder's .npmrc, and without it this install fails with ERESOLVE
# on the jimp peer dependency of @itsliaaa/baileys.
if [ -d mias ] && [ ! -d mias/node_modules ]; then
  echo "[MAIS] Installing MIAS bot dependencies..."
  bash scripts/robust-install.sh mias
fi

# ── Sticker engine self-check (non-fatal, just tells you the truth) ──────────
for d in mias; do
  [ -d "$d/node_modules/wa-sticker-formatter" ] || continue
  (cd "$d" && node -e "const s=require('sharp');require('wa-sticker-formatter');console.log('[MAIS] $d sticker engine OK (sharp '+s.versions.sharp+')')") \
    || echo "[MAIS] WARN: $d sticker engine unavailable"
done

# ── GKTW helper ──────────────────────────────────────────────────────────────
# The upstream @itsreimau/gktw package is 404 on npm and on GitHub, so a local
# drop-in called "cox" lives at <repo>/cox and is wired in via `file:` here.
# Setting GKTW_PACKAGE=<name> still works as a manual override; otherwise cox is
# installed automatically so MIAS' gktwAdapter lights up with no code changes.
GKTW_PACKAGE="${GKTW_PACKAGE:-cox}"
for d in mias; do
  [ -d "$d" ] || continue
  if [ "$GKTW_PACKAGE" = "cox" ]; then
    # cox is a normal "file:../cox" dependency in mias/package.json, so the
    # robust-install above already installed it. Only repair it if missing.
    # (The old line ran: npm install "../${cox_pkg:-cox}/.."  ->  "../cox/.."
    #  which is the REPO ROOT, i.e. it tried to install the root package into
    #  mias, failed, then fell back to a random unrelated "cox" from npm.)
    if [ -d "$d/node_modules/cox" ]; then
      echo "[MAIS] helper cox already installed in $d ✅"
    else
      echo "[MAIS] Installing local helper cox (file:../cox) into $d..."
      (cd "$d" && npm install ../cox --save --no-audit --no-fund --legacy-peer-deps) \
        || echo "[MAIS] WARN: cox install failed in $d — Baileys fallback active."
    fi
  else
    echo "[MAIS] Installing helper $GKTW_PACKAGE into $d..."
    (cd "$d" && npm install "$GKTW_PACKAGE" --no-audit --no-fund --save-optional --legacy-peer-deps) \
      || echo "[MAIS] helper $GKTW_PACKAGE unavailable in $d — Baileys fallback active."
  fi
done

# ── Bad MAC repair: clear stale Signal session keys once. ────────────────────
# The Railway logs show repeated "Session error: Error: Bad MAC" coming from
# libsignal/src/crypto.js:87 because useMultiFileAuthState reloads poisoned
# pre-keys off the persisted auth folder after every reconnect. Wipe the
# app-state-sync-* snapshots and keep creds.json (so you don't get re-paired);
# WhatsApp will rebuild the prekeys on next connect. Set KEEP_BAD_MAC=1 to
# disable.
if [ "${KEEP_BAD_MAC:-0}" != "1" ] && [ -d "${AUTH_DIR:-prezzy_auth}" ]; then
  cleared=$(find "${AUTH_DIR:-prezzy_auth}" -maxdepth 1 -type d -name 'app-state-sync-*' -print -exec rm -rf {} + 2>/dev/null | wc -l)
  echo "[MAIS] Bad-MAC repair: cleared $cleared stale app-state-sync-* snapshot(s) from ${AUTH_DIR:-prezzy_auth}"
fi

# ── Dependency sanity: mias/node_modules must exist or v21/v24 crash on axios ──
# precious-fixes-v21.cjs / precious-fixes-v24.cjs require('axios') at the top.
# axios lives in mias/node_modules; if a previous build skipped that install the
# whole fix-pack chain failed to load. Re-run the install if it's missing.
if [ -d mias ] && [ ! -d mias/node_modules/axios ]; then
  echo "[MAIS] mias/node_modules/axios missing — reinstalling MIAS deps..."
  bash scripts/robust-install.sh mias || npm --prefix mias install --no-audit --no-fund || echo "[MAIS] WARN: mias dep install failed"
fi



echo "[MAIS] Starting..."
# v34: all fixes are baked into the tree; server.js boots the merged master fix boot.
exec node server.js
