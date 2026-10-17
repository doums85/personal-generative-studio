import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthError, CredentialsSignin } from '@auth/core/errors';
import { LOGIN_ERROR_PATH, signInWithPassword } from '../../lib/login-action.mjs';

const isAuthError = (error) => error instanceof AuthError;
const form = (email, password) => new Map([['email', email], ['password', password]]);

/** Next's `redirect()` works by throwing; the stand-in records the target and throws the same way. */
function fakeRedirect() {
  const calls = [];
  const redirect = (path) => {
    calls.push(path);
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${path}` });
  };
  return { redirect, calls };
}

test('the credentials are passed to signIn with the studio as destination', async () => {
  const seen = [];
  const { redirect } = fakeRedirect();
  await signInWithPassword(form('owner@example.com', 'secret'), { signIn: async (...args) => { seen.push(args); }, redirect, isAuthError });
  assert.deepEqual(seen, [['credentials', { email: 'owner@example.com', password: 'secret', redirectTo: '/studio' }]]);
});

test('refused credentials send the visitor back to the form instead of failing the request', async () => {
  const { redirect, calls } = fakeRedirect();
  const signIn = async () => { throw new CredentialsSignin(); };
  await assert.rejects(
    signInWithPassword(form('owner@example.com', 'wrong'), { signIn, redirect, isAuthError }),
    (error) => error.digest === `NEXT_REDIRECT;replace;${LOGIN_ERROR_PATH}`,
  );
  assert.deepEqual(calls, ['/login?error=CredentialsSignin']);
});

test('the redirect of a successful sign-in passes through untouched', async () => {
  const { redirect, calls } = fakeRedirect();
  const success = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/studio;307;' });
  await assert.rejects(signInWithPassword(form('owner@example.com', 'ok'), { signIn: async () => { throw success; }, redirect, isAuthError }), (error) => error === success);
  assert.deepEqual(calls, []);
});

test('unexpected failures are not hidden as a wrong password', async () => {
  const { redirect, calls } = fakeRedirect();
  const failure = new Error('database unreachable');
  await assert.rejects(signInWithPassword(form('owner@example.com', 'ok'), { signIn: async () => { throw failure; }, redirect, isAuthError }), (error) => error === failure);
  assert.deepEqual(calls, []);
});
