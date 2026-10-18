import assert from 'node:assert/strict';
import test from 'node:test';
import { ConvexHttpClient } from 'convex/browser';
import { generateKeyPairSync } from 'node:crypto';
import { ConvexService, api } from '../../lib/convex/service.mjs';
import { StudioStoreError } from '../../lib/studio/store.mjs';
import { PNG, PNG_DATA_URL, createStores, eventually, settings } from './helpers.mjs';

test('Convex refuses callers without the studio key', async () => {
  const anonymous = new ConvexHttpClient(settings().url, { logger: false });
  await assert.rejects(anonymous.query(api.library.listWorkspaces, {}), /Unauthorized|unauthorized/);

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const intruder = new ConvexService({ url: settings().url, privateKey });
  await assert.rejects(intruder.query(api.library.listWorkspaces, {}), (error) => /InvalidAuthHeader|Could not decode token|Unauthorized/i.test(String(error.message)));
});

test('workspaces: create, read, update with merged settings, list, validation and errors', async () => {
  const { studio, workspace, cleanup } = await context();
  try {
    const created = await workspace('Marque');
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual((await studio.getWorkspace(created.id)).settings, {});

    await studio.updateWorkspace(created.id, { settings: { styleNotes: 'grain 16mm' } });
    const updated = await studio.updateWorkspace(created.id, { description: 'Projet', settings: { aspectRatio: '9:16' } });
    assert.equal(updated.description, 'Projet');
    assert.deepEqual(updated.settings, { styleNotes: 'grain 16mm', aspectRatio: '9:16' });
    assert.ok((await studio.listWorkspaces()).some((item) => item.id === created.id));

    await assert.rejects(studio.getWorkspace('00000000-0000-4000-8000-000000000000'), (error) => error instanceof StudioStoreError && error.status === 404 && error.code === 'workspace_not_found');
    await assert.rejects(studio.getWorkspace('../etc'), (error) => error.status === 400 && error.code === 'invalid_id');
    await assert.rejects(studio.createWorkspace({ name: '' }), /too_small|String must|Too small|name/i);
  } finally { await cleanup(); }
});

test('media: bytes round-trip through Convex storage, unsafe names and unknown files are refused', async () => {
  const { studio, workspace, cleanup } = await context();
  try {
    const { id } = await workspace();
    const saved = await studio.saveMedia(id, { dataUrl: PNG_DATA_URL, modality: 'image', label: 'Un phare breton' });
    assert.match(saved.file, /^\d{8}-\d{6}-un-phare-breton-[0-9a-f]{8}\.png$/);
    assert.equal(saved.url, `/api/studio/workspaces/${id}/media/${saved.file}`);
    const read = await studio.readMedia(id, saved.file);
    assert.deepEqual(read.buffer, PNG);
    assert.equal(read.mediaType, 'image/png');
    assert.equal(await studio.mediaAsDataUrl(id, saved.file), PNG_DATA_URL);

    await assert.rejects(studio.readMedia(id, '../secret.png'), (error) => error.status === 400 && error.code === 'invalid_file');
    await assert.rejects(studio.readMedia(id, 'absent.png'), (error) => error.status === 404 && error.code === 'media_not_found');
    await assert.rejects(studio.saveMedia(id, { dataUrl: 'pas-une-data-url' }), (error) => error.code === 'invalid_media');
    await studio.removeMedia(id, saved.file);
    await assert.rejects(studio.readMedia(id, saved.file), (error) => error.status === 404);
  } finally { await cleanup(); }
});

test('media of one workspace is invisible from another', async () => {
  const { studio, workspace, cleanup } = await context();
  try {
    const [a, b] = [await workspace('A'), await workspace('B')];
    const saved = await studio.saveMedia(a.id, { bytes: PNG, mediaType: 'image/png', label: 'secret' });
    await assert.rejects(studio.readMedia(b.id, saved.file), (error) => error.status === 404);
    assert.deepEqual((await studio.readMedia(a.id, saved.file)).buffer, PNG);
  } finally { await cleanup(); }
});

test('elements: images are stored, reordered, replaced and deleted with their files', async () => {
  const { studio, workspace, cleanup } = await context();
  try {
    const { id } = await workspace();
    const element = await studio.createElement(id, { kind: 'avatar', name: 'Maya', description: 'Présentatrice', tags: ['cuisine'], voice: { voice: 'nova' } }, { images: [{ dataUrl: PNG_DATA_URL, source: 'upload' }, { bytes: PNG, mediaType: 'image/png', source: 'generated' }] });
    assert.equal(element.images.length, 2);
    assert.equal(element.images[0].url, `/api/studio/workspaces/${id}/media/${element.images[0].file}`);
    assert.equal(element.images[1].source, 'generated');
    assert.equal((await studio.workspaceSummary(id)).counts.elements, 1);

    const [first, second] = element.images;
    const updated = await studio.updateElement(id, element.id, { name: 'Maya B.', voice: { speed: 1.1 } }, { primaryImageId: second.id });
    assert.equal(updated.name, 'Maya B.');
    assert.deepEqual(updated.voice, { voice: 'nova', speed: 1.1 });
    assert.deepEqual(updated.images.map((image) => image.id), [second.id, first.id]);

    const replaced = await studio.updateElement(id, element.id, {}, { removeImageIds: [first.id], addImages: [{ bytes: PNG, mediaType: 'image/png' }] });
    assert.equal(replaced.images.length, 2);
    await assert.rejects(studio.readMedia(id, first.file), (error) => error.status === 404, 'a removed image loses its file');

    assert.equal((await studio.findElementsByName(id, ['maya b.'])).length, 1);
    assert.equal((await studio.listElements(id, { kind: 'place' })).length, 0);
    const kept = replaced.images.map((image) => image.file);
    await studio.deleteElement(id, element.id);
    for (const file of kept) await assert.rejects(studio.readMedia(id, file), (error) => error.status === 404);
    await assert.rejects(studio.getElement(id, element.id), (error) => error.status === 404 && error.code === 'element_not_found');
    assert.equal((await studio.workspaceSummary(id)).counts.elements, 0);
  } finally { await cleanup(); }
});

test('generations: files, counters, spend, favorites and deletion', async () => {
  const { studio, workspace, cleanup } = await context();
  try {
    const { id } = await workspace();
    const image = await studio.createGeneration(id, { kind: 'image', modality: 'image', prompt: 'Un phare', model: { id: 'lab/img', name: 'Lab', provider: 'lab' }, estimate: { amount: 0.04, currency: 'USD' }, params: { aspectRatio: '1:1', nested: { ok: true } }, warnings: [{ type: 'other', message: 'x' }], media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
    const video = await studio.createGeneration(id, { kind: 'video', modality: 'video', prompt: 'Vagues', estimate: { amount: 0.5 }, media: [{ mediaType: 'video/mp4', uint8Array: new Uint8Array([0, 1, 2, 3]) }, { mediaType: 'audio/wav', uint8Array: new Uint8Array([9, 9]), role: 'audio', modality: 'audio' }] });
    assert.equal(image.files[0].url, `/api/studio/workspaces/${id}/media/${image.files[0].file}`);
    assert.deepEqual(image.params, { aspectRatio: '1:1', nested: { ok: true } });
    assert.equal(video.files[1].role, 'audio');
    assert.equal(video.model, null);
    assert.equal(video.favorite, false);

    const summary = await studio.workspaceSummary(id);
    assert.deepEqual(summary.counts, { elements: 0, generations: 2, images: 1, videos: 1 });
    assert.equal(summary.estimatedSpendUsd, 0.54);
    assert.deepEqual((await studio.listGenerations(id)).map((item) => item.id), [video.id, image.id], 'newest first');
    assert.deepEqual((await studio.listGenerations(id, { kind: 'image' })).map((item) => item.id), [image.id]);
    assert.equal((await studio.listGenerations(id, { limit: 1 })).length, 1);

    const starred = await studio.updateGeneration(id, image.id, { favorite: true, title: 'Mon phare' });
    assert.equal(starred.favorite, true);
    assert.equal(starred.title, 'Mon phare');
    assert.equal((await studio.getGeneration(id, image.id)).favorite, true);
    await assert.rejects(studio.createGeneration(id, { kind: 'poster', modality: 'image', prompt: 'x' }), (error) => error.code === 'invalid_kind');

    await studio.deleteGeneration(id, video.id);
    for (const file of video.files) await assert.rejects(studio.readMedia(id, file.file), (error) => error.status === 404);
    const after = await studio.workspaceSummary(id);
    assert.deepEqual(after.counts, { elements: 0, generations: 1, images: 1, videos: 0 });
    assert.equal(after.estimatedSpendUsd, 0.04);
    await assert.rejects(studio.getGeneration(id, video.id), (error) => error.status === 404 && error.code === 'generation_not_found');
  } finally { await cleanup(); }
});

test('a generation or element of another workspace is not found', async () => {
  const { studio, workspace, cleanup } = await context();
  try {
    const [a, b] = [await workspace('A'), await workspace('B')];
    const generation = await studio.createGeneration(a.id, { kind: 'image', modality: 'image', prompt: 'x', media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
    const element = await studio.createElement(a.id, { kind: 'place', name: 'Cuisine' });
    await assert.rejects(studio.getGeneration(b.id, generation.id), (error) => error.status === 404);
    await assert.rejects(studio.deleteGeneration(b.id, generation.id), (error) => error.status === 404);
    await assert.rejects(studio.getElement(b.id, element.id), (error) => error.status === 404);
    assert.equal((await studio.listGenerations(b.id)).length, 0);
  } finally { await cleanup(); }
});

test('deleting a workspace removes it at once and purges its data and files in the background', async () => {
  const { studio, workspace, social, cleanup } = await context();
  try {
    const { id } = await workspace();
    const generation = await studio.createGeneration(id, { kind: 'image', modality: 'image', prompt: 'x', media: [{ mediaType: 'image/png', base64: PNG.toString('base64') }] });
    await social.upsertAccounts(id, [{ platform: 'facebook', externalId: 'p1', name: 'Page', credentials: { accessToken: 'T' } }]);
    await studio.deleteWorkspace(id);
    await assert.rejects(studio.getWorkspace(id), (error) => error.status === 404);
    const gone = await eventually(async () => {
      try { await studio.readMedia(id, generation.files[0].file); return false; } catch (error) { return error.status === 404; }
    });
    assert.ok(gone, 'the stored file is deleted by the background purge');
    await assert.rejects(studio.deleteWorkspace(id), (error) => error.status === 404);
  } finally { await cleanup(); }
});

async function context() {
  const stores = createStores();
  return { studio: stores.studio, social: stores.social, workspace: stores.workspace, cleanup: stores.cleanup };
}
