'use strict';

const crypto = require('crypto');

const ALGO   = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV, recommended for AES-GCM

// ── Key loading ───────────────────────────────────────────────────────────────

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return buf;
}

// ── Encrypt ───────────────────────────────────────────────────────────────────
// Returns: "enc:<iv_hex>:<tag_hex>:<ciphertext_hex>"
// Returns the plaintext string unchanged if ENCRYPTION_KEY is not set (dev fallback).
// Returns null if value is null.

function encrypt(value) {
  if (value == null) return null;
  const key = getKey();
  if (!key) return String(value); // no-op in dev when key is not configured

  const iv       = crypto.randomBytes(IV_LEN);
  const cipher   = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = String(value);
  const ct       = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag      = cipher.getAuthTag();

  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

// ── Decrypt ───────────────────────────────────────────────────────────────────
// Accepts "enc:..." ciphertext or a plain string (legacy plaintext fallthrough).
// Returns the decrypted string, or the original value if it is not encrypted.
// Returns null if value is null.

function decrypt(value) {
  if (value == null) return null;
  const str = String(value);
  if (!str.startsWith('enc:')) return str; // plaintext fallthrough (unencrypted legacy data)

  const key = getKey();
  if (!key) return str; // can't decrypt without key — return raw

  const parts = str.split(':');
  if (parts.length !== 4) return str; // malformed — return raw rather than throw

  try {
    const iv      = Buffer.from(parts[1], 'hex');
    const tag     = Buffer.from(parts[2], 'hex');
    const ct      = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct) + decipher.final('utf8');
  } catch {
    return str; // decryption failed — return raw (wrong key, corruption, etc.)
  }
}

// ── Decrypt as number ─────────────────────────────────────────────────────────
// Decrypts and coerces to a JS number. Returns null if the result is not numeric.

function decryptNum(value) {
  if (value == null) return null;
  const str = decrypt(value);
  if (str == null) return null;
  const n = Number(str);
  return isNaN(n) ? null : n;
}

module.exports = { encrypt, decrypt, decryptNum };
