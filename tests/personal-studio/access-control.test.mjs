import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedEmail, isAllowedSession, parseAllowedEmails } from '../../lib/access-control.mjs';

test('parses a normalized exact-email allowlist', () => {
  assert.deepEqual([...parseAllowedEmails(' Owner@Example.com, second@example.com, ')], ['owner@example.com', 'second@example.com']);
});

test('rejects empty configuration and non-exact domains', () => {
  assert.equal(isAllowedEmail('owner@example.com', ''), false);
  assert.equal(isAllowedEmail('attacker@sub.example.com', 'owner@example.com'), false);
});

test('accepts the configured owner session case-insensitively', () => {
  assert.equal(isAllowedSession({ user: { email: 'OWNER@example.com' } }, 'owner@example.com'), true);
});
