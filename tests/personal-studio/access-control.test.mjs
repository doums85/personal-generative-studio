import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedEmail, isAllowedSession, isLocalPreview, isPublicPath, parseAllowedEmails } from '../../lib/access-control.mjs';

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

test('hashes and verifies passwords without storing them', async () => {
  const { generatePassword, hashPassword, verifyPassword } = await import('../../lib/password.mjs');
  const password = generatePassword();
  const stored = hashPassword(password);
  assert.equal(stored.includes(password), false);
  assert.notEqual(stored, hashPassword(password));
  assert.equal(verifyPassword(password, stored), true);
  assert.equal(verifyPassword(`${password}x`, stored), false);
  assert.equal(verifyPassword(password, ''), false);
  assert.equal(verifyPassword(password, 'scrypt.bad'), false);
  assert.throws(() => hashPassword('short'));
});

test('only self-authenticating endpoints are reachable without a session', () => {
  for (const pathname of ['/login', '/terms', '/privacy', '/tiktokuW6LPECJuFN7cBHsWvRnBgEd3igtfTb4.txt', '/api/auth/callback/credentials', '/api/mcp', '/api/mcp/some-token', '/api/studio/social/run-due', '/api/studio/public/0123abcd/workspace-id/media.png']) {
    assert.equal(isPublicPath(pathname), true, pathname);
  }
  for (const pathname of ['/', '/terms/extra', '/privacy/x', '/tiktok.txt', '/tiktokabc/x.txt', '/studio', '/studio/social', '/api/studio/workspaces', '/api/studio/workspaces/w1/media/a.png', '/api/studio/social/callback/meta', '/api/studio/social/run-due/extra', '/api/studio/publicity', '/api/studio/config', '/api/gateway/generate']) {
    assert.equal(isPublicPath(pathname), false, pathname);
  }
});
