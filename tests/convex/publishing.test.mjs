import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../lib/convex/api.mjs';
import { SocialError } from '../../lib/social/errors.mjs';
import { StudioStoreError } from '../../lib/studio/errors.mjs';
import { FAKE_URL, startFakePlatform } from './fake-platform.mjs';
import { PNG, createStores, eventually, settings } from './helpers.mjs';

let fake;
before(async () => { fake = await startFakePlatform({ reelPolls: 5 }); });
after(async () => { await fake.close(); });

/** A workspace with an image, a video and a Facebook Page and an Instagram account, all stored in Convex. */
async function fixture(stores) {
  const workspace = await stores.workspace('Publier');
  const image = await stores.studio.createGeneration(workspace.id, { kind: 'image', modality: 'image', prompt: 'Affiche', params: { aspectRatio: '1:1' }, media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
  const story = await stores.studio.createGeneration(workspace.id, { kind: 'image', modality: 'image', prompt: 'Story', params: { aspectRatio: '9:16' }, media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
  const video = await stores.studio.createGeneration(workspace.id, { kind: 'video', modality: 'video', prompt: 'Clip', params: { aspectRatio: '9:16' }, media: [{ mediaType: 'video/mp4', uint8Array: new Uint8Array([0, 1, 2, 3]) }] });
  const [facebook, instagram] = await stores.social.upsertAccounts(workspace.id, [
    { platform: 'facebook', externalId: 'p1', name: 'Page A', credentials: { accessToken: 'PAGE-A' } },
    { platform: 'instagram', externalId: 'ig1', name: 'Marque A', credentials: { accessToken: 'PAGE-A' } },
  ]);
  return { workspace, image, story, video, facebook, instagram };
}

const publish = (stores, workspaceUid, input) => stores.service.action(api.publishing.publish, { workspaceUid, input });

function scheduledFields(generation, account, caption, inMs) {
  return {
    generationId: generation.id, fileId: generation.files[0].id, accountId: account.id, platform: account.platform, accountName: account.name,
    caption, options: {}, media: { kind: 'image', file: generation.files[0].file }, status: 'scheduled', scheduledAt: new Date(Date.now() + inMs).toISOString(),
  };
}

const sent = (caption) => fake.calls.filter((call) => call.body.caption === caption);

test('publishing now: Convex sends it and returns the result, history stays in Convex', async () => {
  const stores = createStores();
  try {
    const { workspace, image, facebook } = await fixture(stores);
    fake.reset();
    const [publication] = await publish(stores, workspace.id, { generationId: image.id, caption: 'Maintenant', targets: [{ accountId: facebook.id }] });
    assert.equal(publication.status, 'published');
    assert.match(publication.url, /^https:\/\/www\.facebook\.com\/p1_\d+$/);
    assert.equal(publication.media, undefined, 'internal fields do not leave Convex');
    const call = sent('Maintenant')[0];
    assert.equal(call.path.endsWith('/p1/photos'), true);
    assert.equal(call.body.access_token, 'PAGE-A', 'Convex decrypted the stored token');
    assert.match(call.body.url, new RegExp(`^${FAKE_URL}/api/studio/public/[0-9a-f]{40}/.+\\.png\\?format=jpeg$`));
    const history = await stores.social.listPublications(workspace.id, { generationId: image.id });
    assert.equal(history.length, 1);
    assert.equal(history[0].status, 'published');
    assert.ok(history[0].publishedAt);
  } finally { await stores.cleanup(); }
});

test('a Reel still processing on the network is followed by Convex itself until it is live', async () => {
  const stores = createStores();
  try {
    const { workspace, video, instagram } = await fixture(stores);
    fake.reset();
    const [started] = await publish(stores, workspace.id, { generationId: video.id, caption: 'Reel', targets: [{ accountId: instagram.id }] });
    assert.equal(started.status, 'processing');
    const done = await eventually(async () => {
      const current = await stores.social.getPublication(workspace.id, started.id);
      return current.status === 'published' ? current : null;
    }, { timeout: 90000, every: 1000 });
    assert.ok(done, 'the publication reached "published" with nobody polling');
    assert.match(done.url, /^https:\/\/www\.instagram\.com\/p\/igpost\d+\/$/);
    assert.ok(fake.calls.filter((call) => /\/c\d+$/.test(call.path)).length >= 6, 'the container was checked until ready');
    assert.equal(fake.calls.filter((call) => call.path.endsWith('/ig1/media_publish')).length, 1, 'published exactly once');
  } finally { await stores.cleanup(); }
});

test('a scheduled publication is sent by Convex at its time, once', async () => {
  const stores = createStores();
  try {
    const { workspace, image, facebook } = await fixture(stores);
    fake.reset();
    const scheduled = await stores.social.createPublication(workspace.id, scheduledFields(image, facebook, 'Programmée', 3000));
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(sent('Programmée').length, 0, 'nothing is sent early');
    const done = await eventually(async () => {
      const current = await stores.social.getPublication(workspace.id, scheduled.id);
      return current.status === 'published' ? current : null;
    }, { timeout: 40000, every: 500 });
    assert.ok(done, 'the scheduled function sent it');
    assert.ok(Date.parse(done.startedAt) >= Date.parse(scheduled.scheduledAt) - 500, 'not before its time');
    assert.equal(sent('Programmée').length, 1);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.equal(sent('Programmée').length, 1, 'never sent twice');
  } finally { await stores.cleanup(); }
});

test('cancelling a scheduled publication, or deleting its project, cancels the send', async () => {
  const stores = createStores();
  try {
    const { workspace, image, facebook } = await fixture(stores);
    const other = await fixture(stores);
    fake.reset();
    const cancelled = await stores.social.createPublication(workspace.id, scheduledFields(image, facebook, 'À annuler', 4000));
    await stores.social.createPublication(other.workspace.id, scheduledFields(other.image, other.facebook, 'Projet supprimé', 4000));
    await stores.social.deletePublication(workspace.id, cancelled.id);
    await stores.studio.deleteWorkspace(other.workspace.id);
    await new Promise((resolve) => setTimeout(resolve, 9000));
    assert.equal(sent('À annuler').length, 0);
    assert.equal(sent('Projet supprimé').length, 0);
    assert.equal((await stores.social.listPublications(workspace.id)).length, 0);
  } finally { await stores.cleanup(); }
});

test('refusals come back with their message and status instead of a generic server error', async () => {
  const stores = createStores();
  try {
    const { workspace, image, story, instagram, facebook } = await fixture(stores);
    fake.reset();
    await assert.rejects(publish(stores, workspace.id, { generationId: story.id, caption: 'x', targets: [{ accountId: instagram.id }] }), (error) => {
      assert.ok(error instanceof SocialError, String(error));
      assert.equal(error.code, 'not_publishable');
      assert.equal(error.status, 400);
      assert.match(error.message, /entre 4:5 et 1,91:1/);
      return true;
    });
    await assert.rejects(publish(stores, workspace.id, { generationId: image.id, targets: [] }), (error) => error instanceof StudioStoreError && error.status === 400 && error.code === 'invalid_request');
    await assert.rejects(publish(stores, workspace.id, { generationId: image.id, targets: [{ accountId: 'nope' }] }), (error) => error instanceof SocialError && error.status === 404 && error.code === 'account_not_found');
    await assert.rejects(publish(stores, workspace.id, { generationId: 'absent', targets: [{ accountId: facebook.id }] }), (error) => error.status === 404 && error.code === 'generation_not_found');
    await assert.rejects(publish(stores, workspace.id, { generationId: image.id, caption: 'x', scheduledAt: new Date(Date.now() + 10_000).toISOString(), targets: [{ accountId: facebook.id }] }), (error) => error.code === 'invalid_schedule' && /au moins une minute/.test(error.message));
    assert.equal(fake.calls.length, 0, 'nothing reached the network');
  } finally { await stores.cleanup(); }
});

test('scheduling through the action queues the send and stays cancellable', async () => {
  const stores = createStores();
  try {
    const { workspace, image, facebook } = await fixture(stores);
    fake.reset();
    const [scheduled] = await publish(stores, workspace.id, { generationId: image.id, caption: 'Dans deux minutes', scheduledAt: new Date(Date.now() + 120_000).toISOString(), targets: [{ accountId: facebook.id }] });
    assert.equal(scheduled.status, 'scheduled');
    assert.equal(fake.calls.length, 0);
    await stores.social.deletePublication(workspace.id, scheduled.id);
    assert.equal((await stores.social.listPublications(workspace.id)).length, 0);
  } finally { await stores.cleanup(); }
});

test('the publishing action refuses callers without the studio key', async () => {
  const anonymous = new ConvexHttpClient(settings().url, { logger: false });
  await assert.rejects(anonymous.action(api.publishing.publish, { workspaceUid: 'x', input: {} }), /Unauthorized|unauthorized/);
});

test('the watchdog finds late scheduled posts and abandoned ones, and gives up on what cannot be retried safely', async () => {
  const stores = createStores();
  try {
    const { workspace, image, facebook } = await fixture(stores);
    const run = (name, args) => {
      const result = spawnSync('npx', ['convex', 'run', name, JSON.stringify(args)], { env: { ...process.env, CONVEX_AGENT_MODE: 'anonymous' }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const start = result.stdout.indexOf('{');
      return start < 0 ? null : JSON.parse(result.stdout.slice(start));
    };
    const late = await stores.social.createPublication(workspace.id, scheduledFields(image, facebook, 'Tard', 3_600_000));
    const abandoned = await stores.social.createPublication(workspace.id, { ...scheduledFields(image, facebook, 'Abandonnée', 0), status: 'processing', scheduledAt: undefined });
    const future = new Date(Date.now() + 2 * 3_600_000).toISOString();

    const stuck = run('socialInternal:listStuck', { dueBefore: future, staleBefore: future });
    assert.ok(stuck.due.some((row) => row.uid === late.id), 'a scheduled post past its time is listed');
    assert.ok(stuck.stalled.some((row) => row.uid === abandoned.id && row.hasState === false), 'a processing post nobody follows is listed');
    const none = run('socialInternal:listStuck', { dueBefore: new Date(Date.now() - 3_600_000).toISOString(), staleBefore: new Date(Date.now() - 3_600_000).toISOString() });
    assert.ok(!none.due.some((row) => row.uid === late.id) && !none.stalled.some((row) => row.uid === abandoned.id), 'recent ones are left alone');

    run('socialInternal:failInterrupted', { workspaceUid: workspace.id, uid: abandoned.id, updatedAt: new Date().toISOString() });
    const failed = await stores.social.getPublication(workspace.id, abandoned.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /interrompue/);

    const swept = run('publishing:sweep', {});
    assert.equal(typeof swept.due, 'number');
  } finally { await stores.cleanup(); }
});
