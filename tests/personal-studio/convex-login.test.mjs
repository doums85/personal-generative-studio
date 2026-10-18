import assert from 'node:assert/strict';
import test from 'node:test';
import { clearOwnerCache, ownerFromToken } from '../../lib/server/convex-owner.mjs';
import { loginProvider } from '../../lib/server/login-provider.mjs';
import { safeCallbackPath } from '../../lib/login-redirect.mjs';

const ENV = { CONVEX_URL: 'https://example.convex.cloud', ALLOWED_EMAILS: 'owner@example.com' };

function fakeClient(answers) {
  const calls = [];
  return {
    calls,
    createClient: () => ({
      setAuth(token) { calls.push({ token }); },
      async query() {
        const answer = answers.shift();
        if (answer instanceof Error) throw answer;
        return answer;
      },
    }),
  };
}

test('the login system is the password one unless Convex is asked for, and Convex needs its address', () => {
  assert.equal(loginProvider({}), 'password');
  assert.equal(loginProvider({ LOGIN_PROVIDER: 'password' }), 'password');
  assert.equal(loginProvider({ LOGIN_PROVIDER: ' Convex ', CONVEX_URL: 'https://x.convex.cloud' }), 'convex');
  assert.equal(loginProvider({ LOGIN_PROVIDER: 'convex', NEXT_PUBLIC_CONVEX_URL: 'https://x.convex.cloud' }), 'convex');
  assert.throws(() => loginProvider({ LOGIN_PROVIDER: 'convex' }), /CONVEX_URL/);
});

test('only paths of this site are accepted after signing in', () => {
  assert.equal(safeCallbackPath('/studio/social?x=1'), '/studio/social?x=1');
  assert.equal(safeCallbackPath(undefined), '/studio');
  for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/studio\nSet-Cookie: a=b', '/login', '/login?error=1', '/api/auth']) {
    assert.equal(safeCallbackPath(bad), '/studio', bad);
  }
});

test('a session token is the owner only if Convex vouches for it and the address is the allowed one', async () => {
  clearOwnerCache();
  const ok = fakeClient([{ email: 'Owner@Example.com' }]);
  assert.deepEqual(await ownerFromToken('t1', { env: ENV, createClient: ok.createClient }), { user: { email: 'Owner@Example.com' } });
  assert.deepEqual(ok.calls, [{ token: 't1' }]);

  assert.equal(await ownerFromToken('t2', { env: ENV, createClient: fakeClient([{ email: 'other@example.com' }]).createClient }), null, 'a valid session for another address');
  assert.equal(await ownerFromToken('t3', { env: ENV, createClient: fakeClient([null]).createClient }), null, 'a token Convex does not recognise');
  assert.equal(await ownerFromToken('t4', { env: ENV, createClient: fakeClient([new Error('boom')]).createClient }), null, 'Convex unreachable');
  assert.equal(await ownerFromToken('', { env: ENV, createClient: fakeClient([]).createClient }), null, 'no cookie');
  assert.equal(await ownerFromToken('t5', { env: { ALLOWED_EMAILS: 'owner@example.com' }, createClient: fakeClient([{ email: 'owner@example.com' }]).createClient }), null, 'no Convex address');
  assert.equal(await ownerFromToken('t6', { env: { CONVEX_URL: ENV.CONVEX_URL }, createClient: fakeClient([{ email: 'owner@example.com' }]).createClient }), null, 'nobody is allowed when ALLOWED_EMAILS is empty');
});

test('the answer is remembered briefly, then asked again; a failure is never remembered', async () => {
  clearOwnerCache();
  let clock = 1_000_000;
  const fake = fakeClient([{ email: 'owner@example.com' }, null]);
  const options = { env: ENV, now: () => clock, createClient: fake.createClient };
  assert.ok(await ownerFromToken('same', options));
  clock += 10_000;
  assert.ok(await ownerFromToken('same', options), 'still remembered after 10 s: no second question');
  assert.equal(fake.calls.length, 1);
  clock += 25_000;
  assert.equal(await ownerFromToken('same', options), null, 'asked again after 35 s: the session was revoked');
  assert.equal(fake.calls.length, 2);

  const failing = fakeClient([new Error('down'), { email: 'owner@example.com' }]);
  const retry = { env: ENV, now: () => clock, createClient: failing.createClient };
  assert.equal(await ownerFromToken('retry', retry), null);
  assert.ok(await ownerFromToken('retry', retry), 'the next request asks again');
});

test('the proxy never treats a `?code=` in the URL as a sign-in code (OAuth callbacks of Meta and TikTok carry one)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../proxy.js', import.meta.url), 'utf8');
  assert.ok(source.includes('shouldHandleCode: false'));
});
