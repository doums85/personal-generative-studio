import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../lib/convex/api.mjs';
import { ConvexService } from '../../lib/convex/service.mjs';
import { CONVEX_AUTH_ENV } from './fake-platform.mjs';
import { createStores, settings } from './helpers.mjs';

const OWNER = CONVEX_AUTH_ENV.ALLOWED_EMAILS;
const PASSWORD = 'correct-horse-battery-staple';

const anonymous = () => new ConvexHttpClient(settings().url, { logger: false });
const ownerService = () => new ConvexService(settings());
/** Exchanging a refresh token for new tokens: Convex answers with no tokens when the session is gone. */
const refresh = async (refreshToken) => {
  try { return (await anonymous().action('auth:signIn', { refreshToken }))?.tokens ?? null; } catch { return null; }
};
const signIn = (params) => anonymous().action('auth:signIn', { provider: 'password', params: { flow: 'signIn', ...params } });

async function signedIn(token) {
  const client = anonymous();
  client.setAuth(token);
  return client;
}

test('the owner account is created by the studio server, and a later call only changes the password', async () => {
  const first = await ownerService().action(api.authAdmin.setOwnerPassword, { email: OWNER, password: PASSWORD });
  assert.equal(typeof first.created, 'boolean');
  const again = await ownerService().action(api.authAdmin.setOwnerPassword, { email: OWNER.toUpperCase(), password: PASSWORD });
  assert.equal(again.created, false);
  await assert.rejects(ownerService().action(api.authAdmin.setOwnerPassword, { email: 'intrus@example.com', password: PASSWORD }), /ALLOWED_EMAILS/);
  await assert.rejects(ownerService().action(api.authAdmin.setOwnerPassword, { email: OWNER, password: 'court' }), /au moins 12/);
  await assert.rejects(anonymous().action(api.authAdmin.setOwnerPassword, { email: OWNER, password: PASSWORD }), /Unauthorized|unauthorized/);
});

test('signing in returns a session that Convex recognises as the owner', async () => {
  const { tokens } = await signIn({ email: `  ${OWNER.toUpperCase()} `, password: PASSWORD });
  assert.ok(tokens?.token && tokens?.refreshToken);
  const client = await signedIn(tokens.token);
  assert.deepEqual(await client.query(api.session.viewer, {}), { email: OWNER });
  assert.equal(await client.query('auth:isAuthenticated', {}), true);
  assert.equal(await anonymous().query(api.session.viewer, {}), null, 'a visitor without a session is nobody');
  assert.equal(await anonymous().query('auth:isAuthenticated', {}), false);
});

test('wrong passwords, unknown or foreign addresses, sign-up and reset flows are all refused', async () => {
  await assert.rejects(signIn({ email: OWNER, password: 'wrong-wrong-wrong' }));
  await assert.rejects(signIn({ email: 'intrus@example.com', password: PASSWORD }));
  await assert.rejects(signIn({ email: OWNER }), 'no password');
  await assert.rejects(signIn({ email: OWNER, password: 'abcdefghijkl', flow: 'signUp' }), 'nobody can open an account, not even for the owner address');
  await assert.rejects(signIn({ email: 'intrus@example.com', password: 'abcdefghijkl', flow: 'signUp' }));
  await assert.rejects(signIn({ email: OWNER, flow: 'reset' }));
  await assert.rejects(signIn({ email: OWNER, newPassword: 'abcdefghijkl', code: '1', flow: 'reset-verification' }));
  await assert.rejects(signIn({ email: OWNER, code: '1', flow: 'email-verification' }));
});

test('a signed-in session opens none of the studio functions: those are for the studio servers only', async () => {
  const { tokens } = await signIn({ email: OWNER, password: PASSWORD });
  const client = await signedIn(tokens.token);
  await assert.rejects(client.query(api.library.listWorkspaces, {}));
  await assert.rejects(client.mutation(api.library.createWorkspace, { name: 'Intrus' }));
  await assert.rejects(client.query(api.social.listAccounts, { workspaceUid: 'x' }));
  await assert.rejects(client.action(api.publishing.publish, { workspaceUid: 'x', input: {} }));
  await assert.rejects(client.action(api.authAdmin.setOwnerPassword, { email: OWNER, password: 'another-long-password' }));
});

test('the studio servers\' own token is not a visitor: the viewer query ignores it', async () => {
  const stores = createStores();
  assert.equal(await stores.service.query(api.session.viewer, {}), null);
});

test('changing the password signs the old sessions out and the new password works', async () => {
  const { tokens } = await signIn({ email: OWNER, password: PASSWORD });
  await ownerService().action(api.authAdmin.setOwnerPassword, { email: OWNER, password: 'a-brand-new-password' });
  assert.equal(await (await signedIn(tokens.token)).query(api.session.viewer, {}), null, 'the old access token stops working at once, not when it expires');
  await assert.rejects(signIn({ email: OWNER, password: PASSWORD }), 'old password');
  assert.equal(await refresh(tokens.refreshToken), null, 'the old session cannot be renewed');
  const fresh = await signIn({ email: OWNER, password: 'a-brand-new-password' });
  assert.ok(fresh.tokens.token);
  await ownerService().action(api.authAdmin.setOwnerPassword, { email: OWNER, password: PASSWORD });
});

test('signing out ends the session', async () => {
  const live = await signIn({ email: OWNER, password: PASSWORD });
  assert.ok((await refresh(live.tokens.refreshToken))?.token, 'a live session can be renewed');
  const { tokens } = await signIn({ email: OWNER, password: PASSWORD });
  const client = await signedIn(tokens.token);
  assert.deepEqual(await client.query(api.session.viewer, {}), { email: OWNER });
  await client.action('auth:signOut', {});
  assert.equal(await (await signedIn(tokens.token)).query(api.session.viewer, {}), null, 'a copied access token is useless after signing out');
  assert.equal(await refresh(tokens.refreshToken), null, 'the session cannot be renewed any more');
});
