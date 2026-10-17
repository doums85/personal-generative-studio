import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { SocialError } from './errors.mjs';

/** Secret protecting stored tokens and OAuth state. Falls back to the login secret. */
export function socialSecret(env = process.env) {
  const secret = env.SOCIAL_TOKEN_SECRET || env.AUTH_SECRET || '';
  if (!secret) throw new SocialError('Définissez SOCIAL_TOKEN_SECRET (ou AUTH_SECRET) pour chiffrer les jetons des réseaux sociaux.', 500, 'secret_missing');
  return secret;
}

function key(secret, purpose) {
  return Buffer.from(hkdfSync('sha256', secret, 'personal-generative-studio', `social:${purpose}`, 32));
}

const encode = (buffer) => Buffer.from(buffer).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url');

/** AES-256-GCM envelope: `v1.<iv>.<tag>.<ciphertext>`. */
export function encryptJson(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret, 'tokens'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', encode(iv), encode(cipher.getAuthTag()), encode(body)].join('.');
}

export function decryptJson(payload, secret) {
  const [version, iv, tag, body] = String(payload || '').split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new SocialError('Jetons illisibles : reconnectez le compte.', 409, 'credentials_unreadable');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secret, 'tokens'), decode(iv));
    decipher.setAuthTag(decode(tag));
    return JSON.parse(Buffer.concat([decipher.update(decode(body)), decipher.final()]).toString('utf8'));
  } catch {
    throw new SocialError('Jetons illisibles (secret modifié ?) : reconnectez le compte.', 409, 'credentials_unreadable');
  }
}

function sign(body, secret) {
  return createHmac('sha256', key(secret, 'state')).update(body).digest('base64url');
}

/** Signed, expiring OAuth `state` that carries the workspace the connection is for. */
export function signState(payload, secret, { now = Date.now(), ttlMs = 10 * 60 * 1000 } = {}) {
  const body = encode(JSON.stringify({ ...payload, exp: now + ttlMs }));
  return `${body}.${sign(body, secret)}`;
}

export function verifyState(state, secret, { now = Date.now() } = {}) {
  const [body, signature] = String(state || '').split('.');
  const invalid = () => new SocialError('Lien de connexion invalide ou expiré : relancez la connexion.', 400, 'invalid_state');
  if (!body || !signature) throw invalid();
  const expected = sign(body, secret);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw invalid();
  let payload;
  try { payload = JSON.parse(decode(body).toString('utf8')); } catch { throw invalid(); }
  if (!payload?.exp || payload.exp < now) throw invalid();
  return payload;
}

export function newNonce() {
  return randomBytes(16).toString('base64url');
}
