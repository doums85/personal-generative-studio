import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const COST = 16384;
// Parts are joined with '.' (absent from base64url): '$' would be expanded by .env loaders.

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('The password must contain at least 8 characters.');
  }
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, { N: COST });
  return [PREFIX, COST, salt.toString('base64url'), key.toString('base64url')].join('.');
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [prefix, cost, salt, key] = stored.split('.');
  if (prefix !== PREFIX || !cost || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(cost) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generatePassword(bytes = 18) {
  return randomBytes(bytes).toString('base64url');
}
