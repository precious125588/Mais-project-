"use strict";

/**
 * MIAS Utility Engine
 * Wraps uuid, crypto-js, moment-timezone, emoji-db, yt-search, google-translate-free, mime-types.
 * Architecture: Services → UtilityEngine → packages
 */

const { v4: uuidv4, v1: uuidv1, validate: uuidValidate } = require("uuid");
const CryptoJS = require("crypto-js");
const moment = require("moment-timezone");

// ─── UUID ─────────────────────────────────────────────────────────────────────

function generateId() { return uuidv4(); }
function generateTimedId() { return uuidv1(); }
function isValidUuid(s) { return uuidValidate(s); }

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function md5(text) {
  return CryptoJS.MD5(String(text)).toString();
}
function sha256(text) {
  return CryptoJS.SHA256(String(text)).toString();
}
function sha1(text) {
  return CryptoJS.SHA1(String(text)).toString();
}
function hmacSha256(text, secret) {
  return CryptoJS.HmacSHA256(String(text), String(secret)).toString();
}
function base64Encode(text) {
  return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(String(text)));
}
function base64Decode(b64) {
  try {
    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(String(b64)));
  } catch { return ""; }
}
function aesEncrypt(text, key) {
  return CryptoJS.AES.encrypt(String(text), String(key)).toString();
}
function aesDecrypt(cipherText, key) {
  try {
    return CryptoJS.AES.decrypt(String(cipherText), String(key)).toString(CryptoJS.enc.Utf8);
  } catch { return ""; }
}

// ─── Moment / time ────────────────────────────────────────────────────────────

function now(tz) {
  return tz ? moment.tz(tz) : moment();
}
function formatDate(date, fmt = "YYYY-MM-DD HH:mm:ss", tz) {
  const m = tz ? moment(date).tz(tz) : moment(date);
  return m.format(fmt);
}
function timeAgo(date) {
  return moment(date).fromNow();
}
function addTime(date, amount, unit) {
  return moment(date).add(amount, unit).toDate();
}
function diffTime(a, b, unit = "seconds") {
  return moment(b).diff(moment(a), unit);
}
function timezone(tz) {
  return moment.tz(tz);
}
function timezoneList() {
  return moment.tz.names();
}

// ─── Emoji DB ─────────────────────────────────────────────────────────────────

let _emojiDb = null;
function _getEmojiDb() {
  if (!_emojiDb) {
    try { _emojiDb = require("emoji-db"); } catch { _emojiDb = {}; }
  }
  return _emojiDb;
}

function findEmoji(name) {
  const db = _getEmojiDb();
  if (db.find) return db.find(name);
  const key = String(name).toLowerCase();
  if (db.emoji) return db.emoji[key] || null;
  return null;
}

function getEmoji(name) {
  const result = findEmoji(name);
  if (typeof result === "string") return result;
  if (result && result.emoji) return result.emoji;
  return name;
}

// ─── YT Search ────────────────────────────────────────────────────────────────

async function ytSearch(query, opts = {}) {
  try {
    const yt = require("yt-search");
    const results = await yt(query);
    return results.videos || results.all || results;
  } catch { return []; }
}

// ─── Google Translate ─────────────────────────────────────────────────────────

async function translate(text, to = "en", from = "auto") {
  try {
    const gt = require("google-translate-free");
    const fn = gt.translate || gt.default?.translate || gt;
    if (typeof fn === "function") {
      const result = await fn(text, { from, to });
      return result?.text || result?.translated || result || text;
    }
    return text;
  } catch { return text; }
}

// ─── MIME types ───────────────────────────────────────────────────────────────

let _mimeTypes = null;
function _getMime() {
  if (!_mimeTypes) {
    try { _mimeTypes = require("mime-types"); } catch { _mimeTypes = null; }
  }
  return _mimeTypes;
}

function lookup(ext) {
  return _getMime()?.lookup(ext) || "application/octet-stream";
}
function extension(mimeType) {
  return _getMime()?.extension(mimeType) || null;
}
function charset(mimeType) {
  return _getMime()?.charset(mimeType) || null;
}
function contentType(ext) {
  return _getMime()?.contentType(ext) || "application/octet-stream";
}

// ─── String utilities ─────────────────────────────────────────────────────────

function truncate(str, max = 100, suffix = "...") {
  const s = String(str || "");
  if (s.length <= max) return s;
  return s.slice(0, max - suffix.length) + suffix;
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function capitalize(str) {
  const s = String(str || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function randomString(length = 8, chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  // UUID
  generateId, generateTimedId, isValidUuid, uuidv4, uuidv1,
  // Crypto
  md5, sha256, sha1, hmacSha256, base64Encode, base64Decode, aesEncrypt, aesDecrypt, CryptoJS,
  // Moment
  moment, now, formatDate, timeAgo, addTime, diffTime, timezone, timezoneList,
  // Emoji
  findEmoji, getEmoji,
  // YT
  ytSearch,
  // Translate
  translate,
  // MIME
  lookup, extension, charset, contentType,
  // String
  truncate, slugify, capitalize, randomString, sleep,
};
