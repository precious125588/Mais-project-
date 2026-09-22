/**
 * MIAS — CJS Handler Bridge
 *
 * This CommonJS file gives CJS modules (case.js, nexray_bot.cjs, etc.)
 * access to the full MIAS handler system without importing ESM directly.
 *
 * Usage in case.js or any CJS file:
 *
 *   const MIAS = require('./mias/handlers/bridge.cjs');
 *   await MIAS.sendText(sock, jid, 'Hello!');
 *   await MIAS.sendImage(sock, jid, buffer, { caption: 'Hi' });
 *   await MIAS.reactSuccess(sock, msg);
 *
 * All functions are forwarded to the ESM handler system via globalThis.__MIAS__
 * which mias/index.js populates at startup.
 *
 * Architecture:  Commands → [this bridge] → Handlers → Baileys Adapter → WhatsApp
 */

"use strict";

// ─── Proxy factory ────────────────────────────────────────────────────────────
// We return a Proxy that resolves each function call through globalThis.__MIAS__
// at call time, so it always reflects the current (possibly not-yet-loaded) handlers.

const MIAS_BRIDGE = new Proxy({}, {
  get(_, prop) {
    // Expose isReady flag directly
    if (prop === "isReady") {
      return !!(globalThis.__MIAS__ && Object.keys(globalThis.__MIAS__).length > 0);
    }

    // Expose the raw handlers object
    if (prop === "handlers") {
      return globalThis.__MIAS__ || {};
    }
    if (prop === "engines") {
      return globalThis.__MIAS_ENGINES__ || {};
    }
    if (prop === "engineStatus") {
      return async function () {
        return typeof globalThis.__MIAS_ENGINE_STATUS__ === "function"
          ? globalThis.__MIAS_ENGINE_STATUS__()
          : {};
      };
    }
    if (prop === "getEngine") {
      return async function (name) {
        return typeof globalThis.__MIAS_GET_ENGINE__ === "function"
          ? globalThis.__MIAS_GET_ENGINE__(name)
          : null;
      };
    }

    // Forward any function call through __MIAS__
    return async function (...args) {
      const handlers = globalThis.__MIAS__;
      if (!handlers) {
        console.warn(`[MIAS Bridge] Handlers not loaded yet — called: ${String(prop)}`);
        return null;
      }
      const fn = handlers[prop];
      if (typeof fn !== "function") {
        // Silently return null for unknown properties (allows destructuring)
        return null;
      }
      try {
        return await fn(...args);
      } catch (err) {
        console.error(`[MIAS Bridge] Error in ${String(prop)}:`, err?.message || err);
        return null;
      }
    };
  },

  has(_, prop) {
    if (prop === "isReady" || prop === "handlers" || prop === "engines") return true;
    const handlers = globalThis.__MIAS__ || {};
    return prop in handlers;
  },
});

module.exports = MIAS_BRIDGE;
