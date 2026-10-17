import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SocialError } from '../../lib/social/errors.mjs';
import { publishGeneration, refreshPublication, runDuePublications } from '../../lib/social/service.mjs';
import { StudioStore } from '../../lib/studio/store.mjs';
import { SocialStore } from '../../lib/social/store.mjs';
import { ENV, PNG, createStores } from './helpers.mjs';

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

test('accounts: tokens are encrypted before Convex sees them, isolated per workspace, refreshed on reconnect', async () => {
  const stores = createStores();
  try {
    const [a, b] = [await stores.workspace('A'), await stores.workspace('B')];
    const [account] = await stores.social.upsertAccounts(a.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'plaintext-access-token-9f3' } }]);
    assert.equal(account.credentials, undefined);
    assert.equal(account.status, 'active');

    // What Convex stores is ciphertext only.
    const raw = await stores.service.query((await import('../../lib/convex/service.mjs')).api.social.getAccount, { workspaceUid: a.id, uid: account.id });
    assert.ok(!raw.credentials.includes('plaintext-access-token-9f3'));
    assert.deepEqual((await stores.social.getAccount(a.id, account.id)).credentials, { accessToken: 'plaintext-access-token-9f3' });

    assert.equal((await stores.social.listAccounts(b.id)).length, 0);
    await assert.rejects(stores.social.getAccount(b.id, account.id), (error) => error instanceof SocialError && error.status === 404 && /introuvable/.test(error.message));

    const [again] = await stores.social.upsertAccounts(a.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A renommée', credentials: { accessToken: 'new-token' } }]);
    assert.equal(again.id, account.id, 'reconnecting keeps the account');
    assert.equal((await stores.social.listAccounts(a.id)).length, 1);
    assert.equal((await stores.social.getAccount(a.id, account.id)).credentials.accessToken, 'new-token');

    await stores.social.markNeedsReconnect(a.id, account.id);
    assert.equal((await stores.social.listAccounts(a.id))[0].status, 'needs_reconnect');
    await stores.social.updateCredentials(a.id, account.id, { accessToken: 'renewed' });
    assert.equal((await stores.social.listAccounts(a.id))[0].status, 'active');

    await stores.social.removeAccount(a.id, account.id);
    assert.equal((await stores.social.listAccounts(a.id)).length, 0);
    await assert.rejects(stores.social.removeAccount(a.id, account.id), SocialError);
  } finally { await stores.cleanup(); }
});

test('publications: lifecycle, listing per generation, and an atomic claim of scheduled posts', async () => {
  const stores = createStores();
  try {
    const { id } = await stores.workspace();
    const base = { generationId: 'g1', fileId: 'f1', accountId: 'a1', platform: 'facebook', accountName: 'Page', caption: 'Hello', options: {}, media: { kind: 'image', file: 'x.png' } };
    const immediate = await stores.social.createPublication(id, base);
    assert.equal(immediate.status, 'processing');
    assert.ok(immediate.startedAt, 'an immediate publication starts at creation');
    const published = await stores.social.updatePublication(id, immediate.id, { status: 'published', remoteId: 'r1', url: 'https://x/y', state: null });
    assert.equal(published.status, 'published');
    assert.ok(published.publishedAt);
    assert.equal((await stores.social.getPublication(id, immediate.id)).url, 'https://x/y');

    await stores.social.createPublication(id, { ...base, generationId: 'g2' });
    assert.equal((await stores.social.listPublications(id)).length, 2);
    assert.deepEqual((await stores.social.listPublications(id, { generationId: 'g2' })).map((item) => item.generationId), ['g2']);

    const due = Date.now() + 60_000;
    const scheduled = await stores.social.createPublication(id, { ...base, status: 'scheduled', scheduledAt: new Date(due).toISOString() });
    assert.equal(scheduled.startedAt, null);
    assert.equal(await stores.social.claimScheduled(id, scheduled.id, due - 1000), null, 'not due yet');
    const claims = await Promise.all([stores.social.claimScheduled(id, scheduled.id, due + 1000), stores.social.claimScheduled(id, scheduled.id, due + 1000), stores.social.claimScheduled(id, scheduled.id, due + 1000)]);
    assert.equal(claims.filter(Boolean).length, 1, 'concurrent claims: exactly one wins');
    const claimed = await stores.social.getPublication(id, scheduled.id);
    assert.equal(claimed.status, 'processing');
    assert.equal(claimed.startedAt, new Date(due + 1000).toISOString());

    await stores.social.deletePublication(id, scheduled.id);
    await assert.rejects(stores.social.getPublication(id, scheduled.id), (error) => error instanceof SocialError && /Publication introuvable/.test(error.message));
  } finally { await stores.cleanup(); }
});

test('publishing end to end: media in Convex storage, platform call, history in Convex', async () => {
  const stores = createStores();
  try {
    const workspace = await stores.workspace();
    const generation = await stores.studio.createGeneration(workspace.id, { kind: 'image', modality: 'image', prompt: 'Affiche', params: { aspectRatio: '1:1' }, media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
    const [account] = await stores.social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'PAGE-A' } }]);
    const { fetchImpl, calls } = scriptedFetch([{ match: '/p1/photos', method: 'POST', reply: { id: '1', post_id: 'p1_77' } }]);
    const [publication] = await publishGeneration({ social: stores.social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, sleep: async () => {}, input: { generationId: generation.id, caption: 'Nouveau visuel', targets: [{ accountId: account.id }] } });
    assert.equal(publication.status, 'published');
    assert.equal(publication.url, 'https://www.facebook.com/p1_77');
    assert.match(new URLSearchParams(calls[0].body).get('url'), /\/api\/studio\/public\/[0-9a-f]{40}\/.+\.png\?format=jpeg$/);
    const history = await stores.social.listPublications(workspace.id, { generationId: generation.id });
    assert.equal(history.length, 1);
    assert.equal(history[0].status, 'published');
    assert.ok(history[0].publishedAt);
    assert.equal((await refreshPublication({ social: stores.social, workspaceId: workspace.id, publicationId: history[0].id, env: ENV, fetch: fetchImpl })).status, 'published');
    assert.equal(calls.length, 1, 'a finished publication is not sent twice');
  } finally { await stores.cleanup(); }
});

test('a scheduled publication stored in Convex is sent once when due, even by two ticks at once', async () => {
  const stores = createStores();
  try {
    const workspace = await stores.workspace();
    const generation = await stores.studio.createGeneration(workspace.id, { kind: 'image', modality: 'image', prompt: 'Affiche', params: { aspectRatio: '1:1' }, media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
    const [account] = await stores.social.upsertAccounts(workspace.id, [{ platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'PAGE-A' } }]);
    const { fetchImpl, calls } = scriptedFetch([{ match: '/p1/photos', method: 'POST', reply: { id: '1', post_id: 'p1_5' } }]);
    const start = Date.now();
    const [scheduled] = await publishGeneration({ social: stores.social, workspaceId: workspace.id, env: ENV, fetch: fetchImpl, now: () => start, input: { generationId: generation.id, caption: 'Plus tard', scheduledAt: new Date(start + 5 * 60_000).toISOString(), targets: [{ accountId: account.id }] } });
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(calls.length, 0);

    const tick = (minutes) => runDuePublications({ social: stores.social, env: ENV, fetch: fetchImpl, now: () => start + minutes * 60_000 });
    assert.deepEqual(await tick(1), []);
    const results = (await Promise.all([tick(6), tick(6)])).flat();
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'published');
    assert.equal(calls.length, 1);
  } finally { await stores.cleanup(); }
});

test('npm run convex:import copies a file-based library into Convex, keeps ids and bytes, and can be re-run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pgs-import-'));
  const stores = createStores();
  let importedId = null;
  try {
    const files = new StudioStore({ rootDir: root });
    const workspace = await files.createWorkspace({ name: 'Projet importé', settings: { styleNotes: 'grain' } });
    importedId = workspace.id;
    const element = await files.createElement(workspace.id, { kind: 'avatar', name: 'Maya', description: 'Hôte', tags: ['a'], voice: { voice: 'nova' } }, { images: [{ dataUrl: `data:image/png;base64,${PNG.toString('base64')}`, source: 'upload' }] });
    const generation = await files.createGeneration(workspace.id, { kind: 'image', modality: 'image', prompt: 'Un phare', model: { id: 'lab/img', name: 'Lab', provider: 'lab' }, estimate: { amount: 0.04 }, params: { aspectRatio: '1:1' }, media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
    const social = new SocialStore(files, { env: ENV });
    const [account] = await social.upsertAccounts(workspace.id, [{ platform: 'instagram', externalId: 'ig1', name: 'Marque', handle: '@marque', credentials: { accessToken: 'tok-123' } }]);
    await social.createPublication(workspace.id, { generationId: generation.id, fileId: generation.files[0].id, accountId: account.id, platform: 'instagram', accountName: 'Marque', caption: 'Hello', options: {}, media: { kind: 'image', file: generation.files[0].file } });

    const run = (...args) => spawnSync('node', ['scripts/convex-import.mjs', ...args], { env: { ...ENV, STUDIO_DATA_DIR: root }, encoding: 'utf8' });
    const dry = run('--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /À copier : 1 projet\(s\), 1 élément\(s\), 1 création\(s\), 2 fichier\(s\), 1 compte\(s\), 1 publication\(s\)/);
    await assert.rejects(stores.studio.getWorkspace(workspace.id), (error) => error.status === 404, 'a dry run writes nothing');

    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Copié : 1 projet\(s\), 1 élément\(s\), 1 création\(s\), 2 fichier\(s\), 1 compte\(s\), 1 publication\(s\)\. Déjà présents \(ignorés\) : 0/);

    const imported = await stores.studio.workspaceSummary(workspace.id);
    assert.equal(imported.name, 'Projet importé');
    assert.equal(imported.createdAt, workspace.createdAt);
    assert.deepEqual(imported.settings, { styleNotes: 'grain' });
    assert.deepEqual(imported.counts, { elements: 1, generations: 1, images: 1, videos: 0 });
    assert.equal(imported.estimatedSpendUsd, 0.04);
    const copiedElement = await stores.studio.getElement(workspace.id, element.id);
    assert.equal(copiedElement.name, 'Maya');
    assert.deepEqual(copiedElement.voice, { voice: 'nova' });
    assert.deepEqual((await stores.studio.readMedia(workspace.id, copiedElement.images[0].file)).buffer, PNG);
    const copiedGeneration = await stores.studio.getGeneration(workspace.id, generation.id);
    assert.equal(copiedGeneration.prompt, 'Un phare');
    assert.deepEqual((await stores.studio.readMedia(workspace.id, copiedGeneration.files[0].file)).buffer, PNG);
    assert.equal((await stores.social.getAccount(workspace.id, account.id)).credentials.accessToken, 'tok-123', 'tokens survive the copy and still decrypt');
    assert.equal((await stores.social.listPublications(workspace.id)).length, 1);

    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Copié : 0 projet\(s\), 0 élément\(s\), 0 création\(s\), 0 fichier\(s\), 0 compte\(s\), 0 publication\(s\)\. Déjà présents \(ignorés\) : 5/);
    assert.equal((await stores.studio.workspaceSummary(workspace.id)).counts.elements, 1);
  } finally {
    if (importedId) await stores.studio.deleteWorkspace(importedId).catch(() => {});
    await stores.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
