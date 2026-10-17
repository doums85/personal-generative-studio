import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decryptJson, encryptJson, signState, verifyState } from '../../lib/social/crypto.mjs';
import { SocialError } from '../../lib/social/errors.mjs';
import { metaConnector } from '../../lib/social/meta.mjs';
import { checkPublishable } from '../../lib/social/rules.mjs';
import { completeConnection, publishGeneration, refreshPublication, redirectUriFor, runDuePublications, socialOverview, startConnection } from '../../lib/social/service.mjs';
import { cronAuthorized, schedulerStatus } from '../../lib/social/schedule.mjs';
import { startScheduler } from '../../lib/social/scheduler.mjs';
import { SocialStore } from '../../lib/social/store.mjs';
import { tiktokConnector } from '../../lib/social/tiktok.mjs';
import { StudioStore } from '../../lib/studio/store.mjs';
import { describeError } from '../../lib/studio/service.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const ENV = {
  SOCIAL_TOKEN_SECRET: 'social-secret-0123456789-abcdefghij',
  STUDIO_PUBLIC_URL: 'https://studio.example.com',
  STUDIO_MEDIA_SECRET: 'media-secret-0123456789-abcdefghij',
  META_APP_ID: 'meta-id',
  META_APP_SECRET: 'meta-secret',
  TIKTOK_CLIENT_KEY: 'tt-key',
  TIKTOK_CLIENT_SECRET: 'tt-secret',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Scripted fetch: each route answers the first request whose URL contains `match`. */
function scriptedFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? String(init.body) : '', headers: init.headers || {} };
    calls.push(call);
    const route = routes.find((item) => call.url.includes(item.match) && (!item.method || item.method === call.method));
    if (!route) throw new Error(`Unexpected request ${call.method} ${call.url}`);
    const answer = typeof route.reply === 'function' ? route.reply(call) : route.reply;
    return jsonResponse(answer, route.status || 200);
  };
  return { fetchImpl, calls };
}

async function setup({ aspectRatio = '1:1', kind = 'image' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pgs-social-'));
  let tick = 0;
  const studio = new StudioStore({ rootDir: root, now: () => new Date(Date.now() + tick++) });
  const social = new SocialStore(studio, { env: ENV });
  const workspace = await studio.createWorkspace({ name: 'Marque A' });
  const generation = await studio.createGeneration(workspace.id, kind === 'image'
    ? { kind: 'image', modality: 'image', prompt: 'Affiche', params: { aspectRatio }, media: [{ mediaType: 'image/png', base64: PNG }] }
    : { kind: 'video', modality: 'video', prompt: 'Clip', params: { aspectRatio }, media: [{ mediaType: 'video/mp4', uint8Array: new Uint8Array([0, 1, 2]) }] });
  return { studio, social, workspace, generation, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const noSleep = async () => {};

test('encrypted credentials round-trip and refuse tampering or a wrong secret', () => {
  const payload = encryptJson({ accessToken: 'abc' }, ENV.SOCIAL_TOKEN_SECRET);
  assert.ok(!payload.includes('abc'));
  assert.deepEqual(decryptJson(payload, ENV.SOCIAL_TOKEN_SECRET), { accessToken: 'abc' });
  assert.throws(() => decryptJson(payload, 'another-secret-0123456789-abcdefghij'), SocialError);
  const [version, iv, tag, body] = payload.split('.');
  const flipped = `${tag[0] === 'A' ? 'B' : 'A'}${tag.slice(1)}`;
  assert.throws(() => decryptJson([version, iv, flipped, body].join('.'), ENV.SOCIAL_TOKEN_SECRET), SocialError);
});

test('OAuth state is signed, expiring and tamper-proof', () => {
  const state = signState({ workspaceId: 'w1', nonce: 'n' }, ENV.SOCIAL_TOKEN_SECRET, { now: 1000, ttlMs: 500 });
  assert.equal(verifyState(state, ENV.SOCIAL_TOKEN_SECRET, { now: 1200 }).workspaceId, 'w1');
  assert.throws(() => verifyState(state, ENV.SOCIAL_TOKEN_SECRET, { now: 2000 }), /expiré/);
  assert.throws(() => verifyState(`${state}0`, ENV.SOCIAL_TOKEN_SECRET, { now: 1200 }), SocialError);
  assert.throws(() => verifyState(state, 'another-secret-0123456789-abcdefghij', { now: 1200 }), SocialError);
});

test('pre-flight rules block what a platform would refuse', () => {
  const messages = (input) => checkPublishable(input).map((issue) => `${issue.level}:${issue.message}`);
  assert.match(messages({ platform: 'tiktok', kind: null })[0], /error:.*images et des vidéos/);
  assert.match(messages({ platform: 'instagram', kind: 'image', aspectRatio: '9:16' })[0], /error:.*4:5 et 1,91:1/);
  assert.deepEqual(messages({ platform: 'instagram', kind: 'image', aspectRatio: '1:1' }), []);
  assert.match(messages({ platform: 'tiktok', kind: 'video', aspectRatio: '16:9' })[0], /warning:.*9:16/);
  assert.deepEqual(messages({ platform: 'tiktok', kind: 'video', aspectRatio: '9:16' }), []);
  assert.match(messages({ platform: 'instagram', kind: 'image', caption: 'x'.repeat(2201) })[0], /2200/);
  assert.match(messages({ platform: 'instagram', kind: 'image', caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ') })[0], /30 hashtags/);
});

test('the Meta connector turns one login into Facebook Pages and linked Instagram accounts', async () => {
  const { fetchImpl, calls } = scriptedFetch([
    { match: 'oauth/access_token', reply: (call) => (call.url.includes('fb_exchange_token') ? { access_token: 'LONG' } : { access_token: 'SHORT' }) },
    { match: 'me/accounts', reply: { data: [
      { id: 'p1', name: 'Page A', access_token: 'PAGE-A', picture: { data: { url: 'https://img/a.png' } }, instagram_business_account: { id: 'ig1', username: 'marque_a', name: 'Marque A', profile_picture_url: 'https://img/ig.png' } },
      { id: 'p2', name: 'Page B', access_token: 'PAGE-B' },
    ] } },
  ]);
  const accounts = await metaConnector.connect({ env: ENV, code: 'CODE', redirectUri: 'https://studio.example.com/cb', fetch: fetchImpl });
  assert.deepEqual(accounts.map((item) => `${item.platform}:${item.externalId}`), ['facebook:p1', 'instagram:ig1', 'facebook:p2']);
  assert.equal(accounts[1].handle, '@marque_a');
  assert.equal(accounts[1].credentials.accessToken, 'PAGE-A');
  assert.ok(calls[0].url.includes('client_secret=meta-secret') && calls[0].url.includes('code=CODE'));
  assert.ok(calls[1].url.includes('fb_exchange_token=SHORT'));
  assert.ok(calls[2].url.includes('access_token=LONG'));
});

test('authorisation URLs carry the signed state and the right scopes', async () => {
  const { social, workspace, cleanup } = await setup();
  try {
    const meta = await startConnection({ social, workspaceId: workspace.id, connectorId: 'meta', env: ENV });
    const url = new URL(meta.url);
    assert.equal(url.hostname, 'www.facebook.com');
    assert.ok(url.searchParams.get('scope').includes('instagram_content_publish'));
    assert.equal(url.searchParams.get('redirect_uri'), 'https://studio.example.com/api/studio/social/callback/meta');
    assert.equal(verifyState(url.searchParams.get('state'), ENV.SOCIAL_TOKEN_SECRET).workspaceId, workspace.id);

    const tiktok = new URL((await startConnection({ social, workspaceId: workspace.id, connectorId: 'tiktok', env: ENV })).url);
    assert.equal(tiktok.searchParams.get('client_key'), 'tt-key');
    assert.ok(tiktok.searchParams.get('scope').includes('video.publish'));

    await assert.rejects(startConnection({ social, workspaceId: workspace.id, connectorId: 'meta', env: { ...ENV, META_APP_ID: '' } }), /META_APP_ID/);
    await assert.rejects(startConnection({ social, workspaceId: workspace.id, connectorId: 'nope', env: ENV }), /inconnu/);
  } finally { await cleanup(); }
});

test('a connection lands in the workspace named by the state, only from the browser that started it', async () => {
  const { social, workspace, cleanup } = await setup();
  try {
    const { url, nonce } = await startConnection({ social, workspaceId: workspace.id, connectorId: 'tiktok', env: ENV });
    const state = new URL(url).searchParams.get('state');
    const { fetchImpl } = scriptedFetch([
      { match: '/v2/oauth/token/', reply: { access_token: 'plaintext-access-token-9f3', refresh_token: 'plaintext-refresh-token-7b1', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'tt-open-1' } },
      { match: '/v2/user/info/', reply: { data: { user: { open_id: 'tt-open-1', display_name: 'Studio TikTok', avatar_url: 'https://img/tt.png' } }, error: { code: 'ok' } } },
    ]);
    await assert.rejects(completeConnection({ social, connectorId: 'tiktok', code: 'C', state, nonce: 'wrong', env: ENV, fetch: fetchImpl }), /pas été lancée depuis ce navigateur/);
    await assert.rejects(completeConnection({ social, connectorId: 'meta', code: 'C', state, nonce, env: ENV, fetch: fetchImpl }), SocialError);

    const result = await completeConnection({ social, connectorId: 'tiktok', code: 'C', state, nonce, env: ENV, fetch: fetchImpl });
    assert.equal(result.workspaceId, workspace.id);
    const accounts = await social.listAccounts(workspace.id);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].name, 'Studio TikTok');
    assert.equal(accounts[0].credentials, undefined);
    const raw = await readFile(path.join(social.studio.workspaceDir(workspace.id), 'social-accounts.json'), 'utf8');
    assert.ok(!raw.includes('plaintext-access-token-9f3') && !raw.includes('plaintext-refresh-token-7b1'), 'tokens must be encrypted at rest');
    assert.equal((await social.getAccount(workspace.id, accounts[0].id)).credentials.accessToken, 'plaintext-access-token-9f3');

    // Reconnecting the same account refreshes it instead of duplicating it.
    const again = await startConnection({ social, workspaceId: workspace.id, connectorId: 'tiktok', env: ENV });
    await completeConnection({ social, connectorId: 'tiktok', code: 'C2', state: new URL(again.url).searchParams.get('state'), nonce: again.nonce, env: ENV, fetch: fetchImpl });
    assert.equal((await social.listAccounts(workspace.id)).length, 1);
  } finally { await cleanup(); }
});

test('accounts belong to one workspace and disappear with it', async () => {
  const { social, studio, workspace, cleanup } = await setup();
  try {
    const other = await studio.createWorkspace({ name: 'Marque B' });
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'T' } }]);
    assert.equal((await social.listAccounts(other.id)).length, 0);
    await assert.rejects(social.getAccount(other.id, account.id), /introuvable/);
    await social.removeAccount(workspace.id, account.id);
    assert.equal((await social.listAccounts(workspace.id)).length, 0);
    await assert.rejects(social.removeAccount(workspace.id, account.id), SocialError);
  } finally { await cleanup(); }
});

test('Facebook publishes a photo through a JPEG link served by the studio', async () => {
  const { social, workspace, generation, cleanup } = await setup();
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'PAGE-A' } }]);
    const { fetchImpl, calls } = scriptedFetch([{ match: '/p1/photos', method: 'POST', reply: { id: '111', post_id: 'p1_222' } }]);
    const [publication] = await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, sleep: noSleep, input: { generationId: generation.id, caption: 'Nouveau visuel', targets: [{ accountId: account.id }] } });
    assert.equal(publication.status, 'published');
    assert.equal(publication.url, 'https://www.facebook.com/p1_222');
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('access_token'), 'PAGE-A');
    assert.equal(form.get('caption'), 'Nouveau visuel');
    assert.match(form.get('url'), /^https:\/\/studio\.example\.com\/api\/studio\/public\/[0-9a-f]{40}\/.+\.png\?format=jpeg$/);
    assert.equal(publication.media, undefined);
    assert.equal((await social.listPublications(workspace.id, { generationId: generation.id })).length, 1);
  } finally { await cleanup(); }
});

test('Instagram waits for the media container, then publishes and links the post', async () => {
  const { social, workspace, generation, cleanup } = await setup();
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'instagram', externalId: 'ig1', name: 'Marque A', credentials: { accessToken: 'PAGE-A' } }]);
    let statusChecks = 0;
    const { fetchImpl, calls } = scriptedFetch([
      { match: '/ig1/media_publish', method: 'POST', reply: { id: 'post-9' } },
      { match: '/ig1/media', method: 'POST', reply: { id: 'container-1' } },
      { match: '/container-1', reply: () => ({ status_code: (statusChecks += 1) < 2 ? 'IN_PROGRESS' : 'FINISHED' }) },
      { match: '/post-9', reply: { permalink: 'https://www.instagram.com/p/XYZ/' } },
    ]);
    const [publication] = await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, sleep: noSleep, input: { generationId: generation.id, caption: 'Hello #studio', targets: [{ accountId: account.id }] } });
    assert.equal(publication.status, 'published');
    assert.equal(publication.url, 'https://www.instagram.com/p/XYZ/');
    assert.equal(publication.remoteId, 'post-9');
    const container = new URLSearchParams(calls[0].body);
    assert.ok(container.get('image_url').endsWith('?format=jpeg'));
    assert.equal(new URLSearchParams(calls.find((call) => call.url.includes('media_publish')).body).get('creation_id'), 'container-1');
  } finally { await cleanup(); }
});

test('a Reel still processing is followed through refreshPublication', async () => {
  const { social, workspace, generation, cleanup } = await setup({ kind: 'video', aspectRatio: '9:16' });
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'instagram', externalId: 'ig1', name: 'Marque A', credentials: { accessToken: 'T' } }]);
    let finished = false;
    const { fetchImpl, calls } = scriptedFetch([
      { match: '/ig1/media_publish', method: 'POST', reply: { id: 'reel-1' } },
      { match: '/ig1/media', method: 'POST', reply: { id: 'container-2' } },
      { match: '/container-2', reply: () => ({ status_code: finished ? 'FINISHED' : 'IN_PROGRESS' }) },
      { match: '/reel-1', reply: { permalink: 'https://www.instagram.com/reel/R/' } },
    ]);
    const [pending] = await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, sleep: noSleep, settle: { attempts: 2, delayMs: 0 }, input: { generationId: generation.id, caption: 'Reel', targets: [{ accountId: account.id }] } });
    assert.equal(pending.status, 'processing');
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('media_type'), 'REELS');
    assert.ok(form.get('video_url').endsWith('.mp4') && !form.get('video_url').includes('format='));

    finished = true;
    const done = await refreshPublication({ social, workspaceId: workspace.id, publicationId: pending.id, env: ENV, fetch: fetchImpl });
    assert.equal(done.status, 'published');
    assert.equal(done.url, 'https://www.instagram.com/reel/R/');
    // Once finished, further refreshes do not call the platform again.
    const callCount = calls.length;
    await refreshPublication({ social, workspaceId: workspace.id, publicationId: pending.id, env: ENV, fetch: fetchImpl });
    assert.equal(calls.length, callCount);
  } finally { await cleanup(); }
});

test('platform rejections are recorded on the publication and an expired token flags the account', async () => {
  const { social, workspace, generation, cleanup } = await setup();
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'OLD' } }]);
    const { fetchImpl } = scriptedFetch([{ match: '/p1/photos', reply: { error: { message: 'Session expirée', type: 'OAuthException', code: 190 } }, status: 400 }]);
    const [publication] = await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, sleep: noSleep, input: { generationId: generation.id, caption: 'x', targets: [{ accountId: account.id }] } });
    assert.equal(publication.status, 'failed');
    assert.match(publication.error, /Session expirée/);
    assert.equal((await social.listAccounts(workspace.id))[0].status, 'needs_reconnect');
    await assert.rejects(publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, input: { generationId: generation.id, caption: 'x', targets: [{ accountId: account.id }] } }), /reconnecté/);
  } finally { await cleanup(); }
});

test('publishing is refused up front when a platform would reject the creation, or the server has no public address', async () => {
  const { social, workspace, generation, cleanup } = await setup({ aspectRatio: '9:16' });
  try {
    const [instagram, facebook] = await social.upsertAccounts(workspace.id, [
      { platform: 'instagram', externalId: 'ig1', name: 'Marque A', credentials: { accessToken: 'T' } },
      { platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'T' } },
    ]);
    const { fetchImpl, calls } = scriptedFetch([]);
    const request = { generationId: generation.id, caption: 'x', targets: [{ accountId: instagram.id }, { accountId: facebook.id }] };
    await assert.rejects(publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, input: request }), (error) => {
      assert.equal(error.code, 'not_publishable');
      assert.match(error.message, /Instagram · Marque A : Instagram n’accepte que les images entre 4:5/);
      assert.equal(describeError(error).body.details.length, 1);
      return true;
    });
    assert.equal(calls.length, 0);
    assert.equal((await social.listPublications(workspace.id)).length, 0);
    await assert.rejects(publishGeneration({ social, workspaceId: workspace.id, env: { ...ENV, STUDIO_PUBLIC_URL: '' }, fetch: fetchImpl, input: request }), /STUDIO_PUBLIC_URL/);
  } finally { await cleanup(); }
});

test('TikTok posts a video privately by default, can send a draft, and refreshes an expiring session', async () => {
  const { social, workspace, generation, cleanup } = await setup({ kind: 'video', aspectRatio: '9:16' });
  try {
    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'tiktok', externalId: 'tt1', name: 'Studio TikTok', credentials: { accessToken: 'OLD', refreshToken: 'RT', expiresAt: soon } }]);
    const { fetchImpl, calls } = scriptedFetch([
      { match: '/v2/oauth/token/', reply: { access_token: 'NEW', expires_in: 86400, refresh_expires_in: 31536000 } },
      { match: '/v2/post/publish/video/init/', reply: { data: { publish_id: 'v_pub_1' }, error: { code: 'ok' } } },
      { match: '/v2/post/publish/inbox/video/init/', reply: { data: { publish_id: 'v_inbox_1' }, error: { code: 'ok' } } },
      { match: '/v2/post/publish/status/fetch/', reply: (call) => (JSON.parse(call.body).publish_id === 'v_inbox_1' ? { data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } } : { data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7501] }, error: { code: 'ok' } }) },
    ]);
    const run = (options) => publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, sleep: noSleep, input: { generationId: generation.id, caption: 'Mon clip', targets: [{ accountId: account.id, options }] } });

    const [direct] = await run({});
    assert.equal(direct.status, 'published');
    assert.equal(direct.remoteId, '7501');
    const init = calls.find((call) => call.url.endsWith('/v2/post/publish/video/init/'));
    assert.equal(init.headers.Authorization, 'Bearer NEW');
    const body = JSON.parse(init.body);
    assert.equal(body.post_info.privacy_level, 'SELF_ONLY');
    assert.equal(body.post_info.title, 'Mon clip');
    assert.equal(body.source_info.source, 'PULL_FROM_URL');
    assert.equal((await social.getAccount(workspace.id, account.id)).credentials.accessToken, 'NEW');
    assert.equal((await social.getAccount(workspace.id, account.id)).credentials.refreshToken, 'RT');

    const [draft] = await run({ mode: 'draft' });
    assert.equal(draft.status, 'published');
    assert.equal(draft.draft, true);
    assert.equal(JSON.parse(calls.find((call) => call.url.endsWith('/inbox/video/init/')).body).post_info, undefined);
  } finally { await cleanup(); }
});

test('TikTok errors are translated and failed processing is reported', async () => {
  const { social, workspace, generation, cleanup } = await setup({ kind: 'video', aspectRatio: '9:16' });
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'tiktok', externalId: 'tt1', name: 'Studio TikTok', credentials: { accessToken: 'T', refreshToken: 'RT', expiresAt: new Date(Date.now() + 3600e3).toISOString() } }]);
    const input = { generationId: generation.id, caption: 'x', targets: [{ accountId: account.id }] };
    const unverified = scriptedFetch([{ match: '/video/init/', reply: { error: { code: 'url_ownership_unverified', message: 'x' } }, status: 403 }]);
    const [first] = await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: unverified.fetchImpl, sleep: noSleep, input });
    assert.equal(first.status, 'failed');
    assert.match(first.error, /URL properties/);

    const rejected = scriptedFetch([
      { match: '/video/init/', reply: { data: { publish_id: 'p2' }, error: { code: 'ok' } } },
      { match: '/status/fetch/', reply: { data: { status: 'FAILED', fail_reason: 'file_format_check_failed' }, error: { code: 'ok' } } },
    ]);
    const [second] = await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: rejected.fetchImpl, sleep: noSleep, input });
    assert.equal(second.status, 'failed');
    assert.match(second.error, /file_format_check_failed/);
  } finally { await cleanup(); }
});

test('the social overview reports what is configured and the redirect addresses to register', async () => {
  const { social, workspace, cleanup } = await setup();
  try {
    const overview = await socialOverview({ social, workspaceId: workspace.id, env: { ...ENV, TIKTOK_CLIENT_SECRET: '' }, requestOrigin: 'http://localhost:3000' });
    assert.equal(overview.publicMediaConfigured, true);
    assert.equal(overview.publicMediaPrefix, 'https://studio.example.com/api/studio/public/');
    assert.deepEqual(overview.connectors.map((item) => [item.id, item.configured, item.missingEnv]), [['meta', true, []], ['tiktok', false, ['TIKTOK_CLIENT_SECRET']]]);
    assert.equal(overview.connectors[0].redirectUri, 'https://studio.example.com/api/studio/social/callback/meta');
    assert.equal(redirectUriFor('meta', { env: {}, requestOrigin: 'http://localhost:3000' }), 'http://localhost:3000/api/studio/social/callback/meta');
  } finally { await cleanup(); }
});

test('TikTok connector keeps the account usable when the profile lookup fails', async () => {
  const { fetchImpl } = scriptedFetch([
    { match: '/v2/oauth/token/', reply: { access_token: 'AT', refresh_token: 'RT', expires_in: 100, open_id: 'o1' } },
    { match: '/v2/user/info/', reply: { error: { code: 'scope_not_authorized', message: 'no' } }, status: 403 },
  ]);
  const [account] = await tiktokConnector.connect({ env: ENV, code: 'C', redirectUri: 'https://x/cb', fetch: fetchImpl, now: 0 });
  assert.equal(account.externalId, 'o1');
  assert.equal(account.credentials.expiresAt, new Date(100 * 1000).toISOString());
});

const MINUTE = 60 * 1000;

test('a scheduled publication sends nothing until it is due, and refuses unreasonable times', async () => {
  const { social, workspace, generation, cleanup } = await setup();
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'T' } }]);
    const { fetchImpl, calls } = scriptedFetch([{ match: '/p1/photos', method: 'POST', reply: { id: '1', post_id: 'p1_1' } }]);
    const clock = Date.UTC(2026, 9, 20, 8, 0, 0);
    const request = (scheduledAt) => ({ generationId: generation.id, caption: 'Demain', scheduledAt, targets: [{ accountId: account.id }] });
    const publish = (scheduledAt) => publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, sleep: noSleep, now: () => clock, input: request(scheduledAt) });

    await assert.rejects(publish(new Date(clock + 10 * 1000).toISOString()), /au moins une minute/);
    await assert.rejects(publish(new Date(clock + 400 * 24 * 60 * MINUTE).toISOString()), /plus d’un an/);
    await assert.rejects(publish('demain 9h'), (error) => describeError(error).status === 400);

    const due = new Date(clock + 60 * MINUTE).toISOString();
    const [scheduled] = await publish(due);
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(scheduled.scheduledAt, due);
    assert.equal(calls.length, 0);

    const tick = (at) => runDuePublications({ social, env: ENV, fetch: fetchImpl, now: () => at });
    assert.deepEqual(await tick(clock + 59 * MINUTE), []);
    assert.equal(calls.length, 0);

    const [sent] = await tick(clock + 61 * MINUTE);
    assert.equal(sent.status, 'published');
    assert.equal(sent.url, 'https://www.facebook.com/p1_1');
    assert.equal(calls.length, 1);
    assert.deepEqual(await tick(clock + 62 * MINUTE), [], 'a sent publication is never sent twice');
    assert.equal(calls.length, 1);
  } finally { await cleanup(); }
});

test('two scheduler ticks at the same moment send a due publication once', async () => {
  const { social, workspace, generation, cleanup } = await setup();
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'T' } }]);
    const { fetchImpl, calls } = scriptedFetch([{ match: '/p1/photos', method: 'POST', reply: { id: '1', post_id: 'p1_1' } }]);
    const clock = Date.UTC(2026, 9, 20, 8, 0, 0);
    await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, now: () => clock, input: { generationId: generation.id, scheduledAt: new Date(clock + 5 * MINUTE).toISOString(), targets: [{ accountId: account.id }] } });
    const tick = () => runDuePublications({ social, env: ENV, fetch: fetchImpl, now: () => clock + 6 * MINUTE });
    const results = await Promise.all([tick(), tick()]);
    assert.equal(results.flat().length, 1);
    assert.equal(calls.length, 1);
  } finally { await cleanup(); }
});

test('the scheduler finishes a scheduled Reel over several ticks, without the studio open', async () => {
  const { social, workspace, generation, cleanup } = await setup({ kind: 'video', aspectRatio: '9:16' });
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'instagram', externalId: 'ig1', name: 'Marque A', credentials: { accessToken: 'T' } }]);
    let ready = false;
    const { fetchImpl } = scriptedFetch([
      { match: '/ig1/media_publish', method: 'POST', reply: { id: 'reel-1' } },
      { match: '/ig1/media', method: 'POST', reply: { id: 'container-1' } },
      { match: '/container-1', reply: () => ({ status_code: ready ? 'FINISHED' : 'IN_PROGRESS' }) },
      { match: '/reel-1', reply: { permalink: 'https://www.instagram.com/reel/R/' } },
    ]);
    const clock = Date.UTC(2026, 9, 20, 8, 0, 0);
    await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, now: () => clock, input: { generationId: generation.id, caption: 'Reel', scheduledAt: new Date(clock + 5 * MINUTE).toISOString(), targets: [{ accountId: account.id }] } });
    const tick = (minutes) => runDuePublications({ social, env: ENV, fetch: fetchImpl, now: () => clock + minutes * MINUTE });
    assert.equal((await tick(6))[0].status, 'processing');
    assert.equal((await tick(7))[0].status, 'processing');
    ready = true;
    const [done] = await tick(8);
    assert.equal(done.status, 'published');
    assert.equal(done.url, 'https://www.instagram.com/reel/R/');
    assert.deepEqual(await tick(9), []);
  } finally { await cleanup(); }
});

test('a scheduled publication whose account vanished or expired fails visibly instead of disappearing', async () => {
  const { social, workspace, generation, cleanup } = await setup();
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'T' } }]);
    const { fetchImpl, calls } = scriptedFetch([]);
    const clock = Date.UTC(2026, 9, 20, 8, 0, 0);
    await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, now: () => clock, input: { generationId: generation.id, scheduledAt: new Date(clock + 5 * MINUTE).toISOString(), targets: [{ accountId: account.id }] } });
    await social.removeAccount(workspace.id, account.id);
    const [failed] = await runDuePublications({ social, env: ENV, fetch: fetchImpl, now: () => clock + 6 * MINUTE });
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /Compte introuvable/);
    assert.equal(calls.length, 0);
    assert.equal((await social.listPublications(workspace.id))[0].status, 'failed');
  } finally { await cleanup(); }
});

test('a scheduled publication can be cancelled before it is due', async () => {
  const { social, workspace, generation, cleanup } = await setup();
  try {
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'T' } }]);
    const { fetchImpl, calls } = scriptedFetch([]);
    const clock = Date.UTC(2026, 9, 20, 8, 0, 0);
    const [scheduled] = await publishGeneration({ social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, now: () => clock, input: { generationId: generation.id, scheduledAt: new Date(clock + 5 * MINUTE).toISOString(), targets: [{ accountId: account.id }] } });
    await social.deletePublication(workspace.id, scheduled.id);
    assert.deepEqual(await runDuePublications({ social, env: ENV, fetch: fetchImpl, now: () => clock + 10 * MINUTE }), []);
    assert.equal(calls.length, 0);
  } finally { await cleanup(); }
});

test('the cron endpoint secret is compared exactly and the scheduler mode follows the host', async () => {
  assert.equal(cronAuthorized('Bearer s3cret-s3cret-s3cret', { CRON_SECRET: 's3cret-s3cret-s3cret' }), true);
  assert.equal(cronAuthorized('Bearer s3cret-s3cret-s3creT', { CRON_SECRET: 's3cret-s3cret-s3cret' }), false);
  assert.equal(cronAuthorized('Bearer ', { CRON_SECRET: '' }), false);
  assert.equal(cronAuthorized(null, { CRON_SECRET: 'x' }), false);

  assert.deepEqual(schedulerStatus({}), { mode: 'interval', active: true, cron: false });
  assert.deepEqual(schedulerStatus({ VERCEL: '1' }), { mode: 'none', active: false });
  assert.deepEqual(schedulerStatus({ VERCEL: '1', CRON_SECRET: 'x' }), { mode: 'cron', active: true });
  assert.deepEqual(schedulerStatus({ SOCIAL_SCHEDULER: 'off' }), { mode: 'none', active: false });

  assert.equal(startScheduler({ env: { VERCEL: '1' } }), false);
  assert.equal(startScheduler({ env: { SOCIAL_SCHEDULER: 'off' } }), false);
  const first = startScheduler({ env: {}, intervalMs: 3600 * 1000 });
  assert.equal(first, true);
  assert.equal(startScheduler({ env: {}, intervalMs: 3600 * 1000 }), false, 'only one ticker per process');
  clearInterval(globalThis[Symbol.for('personal-generative-studio.social-scheduler')]);
  delete globalThis[Symbol.for('personal-generative-studio.social-scheduler')];
});
