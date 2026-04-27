import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // GCM standard
const TAG_LENGTH = 16;

function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  // Accept either base64 (32 bytes) or hex (64 chars)
  const buf = /^[A-Fa-f0-9]+$/.test(raw) && raw.length === 64
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return buf;
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: iv | tag | ciphertext, base64-encoded
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decrypt(payload) {
  if (!payload) return null;
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

// Encrypt every string value in an object (creds bag like { token, secret })
export function encryptObject(obj) {
  if (!obj) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v == null ? null : encrypt(v);
  }
  return out;
}

export function decryptObject(obj) {
  if (!obj) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v == null ? null : decrypt(v);
  }
  return out;
}
