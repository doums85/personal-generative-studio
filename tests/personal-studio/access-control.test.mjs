import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedEmail, isAllowedSession, isLocalPreview, parseAllowedEmails } from '../../lib/access-control.mjs';

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

test('local preview is limited to development on loopback hosts', () => {
  assert.equal(isLocalPreview({ enabled: 'true', nodeEnv: 'development', hostname: 'localhost' }), true);
  assert.equal(isLocalPreview({ enabled: 'true', nodeEnv: 'production', hostname: 'localhost' }), false);
  assert.equal(isLocalPreview({ enabled: 'true', nodeEnv: 'development', hostname: 'preview.example.com' }), false);
});
