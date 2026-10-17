import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDiskReader, fetchBlobUrl } from '../../lib/server/mcp-http.mjs';
import { SocialStore } from '../../lib/social/store.mjs';
import { StudioStore } from '../../lib/studio/store.mjs';
import { createStudioServer } from '../../mcp/server.mjs';
import { resolveAccounts } from '../../mcp/social-tools.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const CLOCK = Date.UTC(2026, 9, 20, 8, 0, 0);
const ENV = {
  SOCIAL_TOKEN_SECRET: 'social-secret-0123456789-abcdefghij',
  STUDIO_PUBLIC_URL: 'https://studio.example.com',
  STUDIO_MEDIA_SECRET: 'media-secret-0123456789-abcdefghij',
};

function scriptedFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? String(init.body) : '' };
    calls.push(call);
    const route = routes.find((item) => call.url.includes(item.match) && (!item.method || item.method === call.method));
    if (!route) throw new Error(`Unexpected request ${call.method} ${call.url}`);
    return new Response(JSON.stringify(typeof route.reply === 'function' ? route.reply(call) : route.reply), { status: route.status || 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

async function setup({ remote = null, routes = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pgs-mcp-social-'));
  const store = new StudioStore({ rootDir: path.join(root, 'data'), now: () => new Date(CLOCK) });
  const social = new SocialStore(store, { env: ENV });
  const workspace = await store.createWorkspace({ name: 'Marque A' });
  const accounts = await social.upsertAccounts(workspace.id, [
    { platform: 'facebook', externalId: 'p1', name: 'Maison Aya', credentials: { accessToken: 'T' } },
    { platform: 'instagram', externalId: 'ig1', name: 'Maison Aya', handle: '@maison_aya', credentials: { accessToken: 'T' } },
    { platform: 'tiktok', externalId: 'tt1', name: 'Aya Studio', credentials: { accessToken: 'T', refreshToken: 'R', expiresAt: new Date(CLOCK + 3600e3).toISOString() } },
  ]);
  const { fetchImpl, calls } = scriptedFetch(routes);
  const server = createStudioServer({ store, social, env: ENV, fetch: fetchImpl, cwd: root, remote, loadCatalog: async () => [], now: () => new Date(CLOCK) });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const by = (platform) => accounts.find((account) => account.platform === platform);
  return { root, store, social, workspace, accounts, by, client, calls, call: (name, args) => client.callTool({ name, arguments: args }), cleanup: async () => { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); } };
}

test('accounts are resolved from ids, platform, platform:name, handle or unique name, and ambiguity is explained', () => {
  const accounts = [
    { id: 'a1', platform: 'facebook', name: 'Maison Aya', handle: null },
    { id: 'a2', platform: 'instagram', name: 'Maison Aya', handle: '@maison_aya' },
    { id: 'a3', platform: 'tiktok', name: 'Aya Studio', handle: null },
  ];
  const ids = (refs) => resolveAccounts(accounts, refs).map((account) => account.id);
  assert.deepEqual(ids(['a1']), ['a1']);
  assert.deepEqual(ids(['instagram', 'TikTok']), ['a2', 'a3']);
  assert.deepEqual(ids(['facebook:maison aya']), ['a1']);
  assert.deepEqual(ids(['@Maison_Aya']), ['a2']);
  assert.deepEqual(ids(['Aya Studio', 'a3']), ['a3'], 'duplicates collapse');
  assert.throws(() => resolveAccounts(accounts, ['Maison Aya']), /several accounts.*facebook:Maison Aya.*instagram:Maison Aya/);
  assert.throws(() => resolveAccounts(accounts, ['threads']), /No account matches "threads"/);
  assert.throws(() => resolveAccounts([], ['x']), /No social account is connected/);
});

test('Claude can discover accounts and gallery items of a workspace', async () => {
  const ctx = await setup();
  try {
    await ctx.store.createGeneration(ctx.workspace.id, { kind: 'image', modality: 'image', prompt: 'Affiche', params: { aspectRatio: '1:1' }, media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
    const accounts = await ctx.call('list_social_accounts', {});
    assert.match(accounts.content[0].text, /Facebook · Maison Aya/);
    assert.match(accounts.content[0].text, /Instagram · Maison Aya @maison_aya/);
    assert.equal(accounts.structuredContent.accounts.length, 3);
    assert.equal(JSON.stringify(accounts).includes('credentials'), false);
    const generations = await ctx.call('list_generations', { kind: 'image' });
    assert.equal(generations.structuredContent.generations.length, 1);
    assert.equal(generations.structuredContent.generations[0].aspectRatio, '1:1');
  } finally { await ctx.cleanup(); }
});

test('a dry run reports problems per account and neither imports nor sends anything', async () => {
  const ctx = await setup();
  try {
    await writeFile(path.join(ctx.root, 'story.png'), PNG);
    const result = await ctx.call('publish_to_social', { file: 'story.png', aspectRatio: '9:16', accounts: ['instagram', 'facebook'], caption: 'Hello', dryRun: true });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /nothing was sent/);
    assert.match(result.content[0].text, /Instagram · Maison Aya: ERROR Instagram n’accepte que les images entre 4:5 et 1,91:1/);
    assert.match(result.content[0].text, /Facebook · Maison Aya: ready/);
    assert.equal(result.structuredContent.ready, false);
    assert.equal((await ctx.store.listGenerations(ctx.workspace.id)).length, 0);
    assert.equal(ctx.calls.length, 0);
  } finally { await ctx.cleanup(); }
});

test('publishing a local file adds it to the gallery and posts it to the chosen accounts', async () => {
  const ctx = await setup({ routes: [
    { match: '/p1/photos', method: 'POST', reply: { id: '1', post_id: 'p1_77' } },
    { match: '/ig1/media_publish', method: 'POST', reply: { id: 'ig-post' } },
    { match: '/ig1/media', method: 'POST', reply: { id: 'container' } },
    { match: '/container', reply: { status_code: 'FINISHED' } },
    { match: '/ig-post', reply: { permalink: 'https://www.instagram.com/p/ABC/' } },
  ] });
  try {
    await writeFile(path.join(ctx.root, 'poster.png'), PNG);
    const result = await ctx.call('publish_to_social', { file: 'poster.png', aspectRatio: '1:1', accounts: ['facebook', 'instagram:Maison Aya'], caption: 'Nouvelle collection #aya' });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.match(result.content[0].text, /Facebook · Maison Aya: published — https:\/\/www\.facebook\.com\/p1_77/);
    assert.match(result.content[0].text, /Instagram · Maison Aya: published — https:\/\/www\.instagram\.com\/p\/ABC\//);
    const generations = await ctx.store.listGenerations(ctx.workspace.id);
    assert.equal(generations.length, 1);
    assert.equal(generations[0].params.imported, true);
    assert.equal(generations[0].prompt, 'Nouvelle collection #aya');
    const photo = new URLSearchParams(ctx.calls.find((call) => call.url.includes('/p1/photos')).body);
    assert.equal(photo.get('caption'), 'Nouvelle collection #aya');
    assert.match(photo.get('url'), /\?format=jpeg$/);
    assert.equal((await ctx.call('list_publications', {})).structuredContent.publications.length, 2);
  } finally { await ctx.cleanup(); }
});

test('a library generation can be scheduled, TikTok defaults to private, and nothing is sent early', async () => {
  const ctx = await setup();
  try {
    const generation = await ctx.store.createGeneration(ctx.workspace.id, { kind: 'video', modality: 'video', prompt: 'Clip', params: { aspectRatio: '9:16' }, media: [{ mediaType: 'video/mp4', uint8Array: new Uint8Array([0, 1, 2]) }] });
    const result = await ctx.call('publish_to_social', { generation: generation.id, accounts: ['tiktok'], caption: 'Demain', scheduledAt: '2026-10-21T09:00:00+02:00' });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.match(result.content[0].text, /TikTok · Aya Studio: scheduled for 2026-10-21T07:00:00\.000Z/);
    assert.equal(ctx.calls.length, 0);
    const [publication] = await ctx.social.listPublications(ctx.workspace.id);
    assert.equal(publication.status, 'scheduled');
    assert.equal(publication.options.privacyLevel, undefined);

    const tooSoon = await ctx.call('publish_to_social', { generation: generation.id, accounts: ['tiktok'], scheduledAt: '2026-10-20T08:00:10+00:00' });
    assert.equal(tooSoon.isError, true);
    assert.match(tooSoon.content[0].text, /au moins une minute/);
  } finally { await ctx.cleanup(); }
});

test('list_publications follows a Reel still processing until it is live', async () => {
  let ready = false;
  const ctx = await setup({ routes: [
    { match: '/ig1/media_publish', method: 'POST', reply: { id: 'reel-1' } },
    { match: '/ig1/media', method: 'POST', reply: { id: 'container-1' } },
    { match: '/container-1', reply: () => ({ status_code: ready ? 'FINISHED' : 'IN_PROGRESS' }) },
    { match: '/reel-1', reply: { permalink: 'https://www.instagram.com/reel/R/' } },
  ] });
  try {
    await writeFile(path.join(ctx.root, 'clip.mp4'), Buffer.from([0, 1, 2, 3]));
    const started = await ctx.call('publish_to_social', { file: 'clip.mp4', aspectRatio: '9:16', accounts: ['instagram'], caption: 'Reel' });
    assert.match(started.content[0].text, /processing on the platform/);
    assert.equal((await ctx.call('list_publications', {})).structuredContent.publications[0].status, 'processing');
    ready = true;
    const done = await ctx.call('list_publications', {});
    assert.equal(done.structuredContent.publications[0].status, 'published');
    assert.equal(done.structuredContent.publications[0].url, 'https://www.instagram.com/reel/R/');
  } finally { await ctx.cleanup(); }
});

test('every failure is reported as a tool error with the reason', async () => {
  const ctx = await setup({ routes: [{ match: '/p1/photos', reply: { error: { message: 'Session expirée', type: 'OAuthException', code: 190 } }, status: 400 }] });
  try {
    await writeFile(path.join(ctx.root, 'poster.png'), PNG);
    const both = await ctx.call('publish_to_social', { file: 'poster.png', accounts: ['facebook'] });
    assert.equal(both.isError, true);
    assert.match(both.content[0].text, /FAILED — Session expirée/);

    assert.match((await ctx.call('publish_to_social', { accounts: ['facebook'] })).content[0].text, /exactly one of/);
    assert.match((await ctx.call('publish_to_social', { file: 'missing.png', accounts: ['facebook'] })).content[0].text, /File not found/);
    await writeFile(path.join(ctx.root, 'notes.txt'), 'x');
    assert.match((await ctx.call('publish_to_social', { file: 'notes.txt', accounts: ['facebook'] })).content[0].text, /must be an image or a video/);
    assert.match((await ctx.call('publish_to_social', { file: 'poster.png', accounts: ['threads'] })).content[0].text, /No account matches/);
    assert.match((await ctx.call('publish_to_social', { url: 'https://x.test/a.png', accounts: ['facebook'] })).content[0].text, /only supported on the hosted endpoint/);
  } finally { await ctx.cleanup(); }
});

test('the hosted endpoint refuses local paths and only imports links this studio issued', async () => {
  const issued = [];
  const remote = {
    publish: async () => { throw new Error('unused'); },
    fetchOwn: async (url) => { issued.push(url); return url.startsWith('https://files.example.com/') ? { bytes: PNG, mediaType: 'image/png' } : null; },
  };
  const ctx = await setup({ remote, routes: [{ match: '/p1/photos', method: 'POST', reply: { id: '1', post_id: 'p1_9' } }] });
  try {
    assert.match((await ctx.call('publish_to_social', { file: 'poster.png', accounts: ['facebook'] })).content[0].text, /not available on the hosted endpoint/);
    assert.match((await ctx.call('publish_to_social', { url: 'https://evil.example.org/a.png', accounts: ['facebook'] })).content[0].text, /Only links returned by this studio/);
    assert.equal((await ctx.store.listGenerations(ctx.workspace.id)).length, 0);

    const ok = await ctx.call('publish_to_social', { url: 'https://files.example.com/files/abc/poster.png', accounts: ['facebook'], caption: 'Depuis Claude' });
    assert.equal(ok.isError, undefined, ok.content?.[0]?.text);
    assert.match(ok.content[0].text, /published — https:\/\/www\.facebook\.com\/p1_9/);
    assert.equal((await ctx.store.listGenerations(ctx.workspace.id)).length, 1);
  } finally { await ctx.cleanup(); }
});

test('hosted file readers serve only what the studio published', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pgs-reader-'));
  try {
    await mkdir(path.join(root, 'abc'), { recursive: true });
    await writeFile(path.join(root, 'abc', 'a b.png'), PNG);
    await writeFile(path.join(path.dirname(root), 'outside-secret.png'), PNG);
    const read = createDiskReader({ filesRoot: root, publicBaseUrl: 'https://mcp.example.com/' });
    assert.equal((await read('https://mcp.example.com/files/abc/a%20b.png')).mediaType, 'image/png');
    assert.equal(await read('https://other.example.com/files/abc/a%20b.png'), null);
    assert.equal(await read('https://mcp.example.com/files/../outside-secret.png'), null);
    assert.equal(await read('https://mcp.example.com/files/%2e%2e/outside-secret.png'), null);
    assert.equal(await read('https://mcp.example.com/files/abc/missing.png'), null);

    const blobFetch = async () => new Response(PNG, { headers: { 'content-type': 'image/png' } });
    assert.equal((await fetchBlobUrl('https://abc123.public.blob.vercel-storage.com/mcp/x.png', blobFetch)).bytes.length, PNG.length);
    assert.equal(await fetchBlobUrl('http://abc123.public.blob.vercel-storage.com/x.png', blobFetch), null);
    assert.equal(await fetchBlobUrl('https://169.254.169.254/latest/meta-data', blobFetch), null);
    assert.equal(await fetchBlobUrl('https://public.blob.vercel-storage.com.evil.test/x.png', blobFetch), null);
    assert.equal(await fetchBlobUrl('not a url', blobFetch), null);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(path.join(path.dirname(root), 'outside-secret.png'), { force: true });
  }
});
