import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acceptsReferenceAudio, normalizeGatewayCatalog, resolutionToDimensions } from '../../lib/gateway/catalog.mjs';
import { pickVideoRate } from '../../lib/gateway/estimate.mjs';
import { planGeneration, sizeForAspectRatio, toReferenceFile, withProviderResolution } from '../../lib/gateway/engine.mjs';
import { characterSheetPrompt, composePrompt, extractMentions } from '../../lib/studio/prompt.mjs';
import { StudioStore, StudioStoreError } from '../../lib/studio/store.mjs';
import { publicMediaConfig, publicMediaUrl, signMedia, verifyMediaToken } from '../../lib/studio/public-media.mjs';
import { estimateInWorkspace, generateInWorkspace } from '../../lib/studio/service.mjs';
import { chooseVideoModelForSpeech, estimateSpeechSeconds, pickVideoDuration, wavDurationSeconds, withSpeechPrompt } from '../../lib/studio/speech.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const catalog = normalizeGatewayCatalog({ data: [
  { id: 'lab/image-edit', name: 'Image Edit', type: 'image', owned_by: 'lab', pricing: { image: '0.02' } },
  { id: 'openai/gpt-image-1.5', name: 'GPT Image', type: 'image', owned_by: 'openai', pricing: { image: '0.05' } },
  { id: 'lab/video-sync', name: 'Video Sync', type: 'video', owned_by: 'lab', pricing: { video_duration_pricing: [{ resolution: '720p', cost_per_second: '0.05' }, { resolution: '1080p', cost_per_second: '0.1' }] },
    video_capabilities: { supported_operations: ['image-to-video', 'reference-to-video'], supported_resolutions: ['720p', '1080p'], supported_aspect_ratios: ['16:9', '9:16'], supported_durations_seconds: [4, 8, 12], generate_audio: true, input_limits: { image: { max_count: 3, supported_sources: ['url', 'base64'] }, audio: { supported_sources: ['url'], max_duration_seconds: 10 } } } },
  { id: 'lab/video-native', name: 'Video Native', type: 'video', owned_by: 'lab', pricing: { video_duration_pricing: [{ resolution: '720p', audio: false, cost_per_second: '0.1' }, { resolution: '720p', audio: true, cost_per_second: '0.15' }] },
    video_capabilities: { supported_operations: ['image-to-video'], supported_resolutions: ['720p'], supported_aspect_ratios: ['16:9'], supported_durations_seconds: [4, 6, 8], generate_audio: true, input_limits: { image: { max_count: 1 } } } },
  { id: 'lab/video-silent', name: 'Video Silent', type: 'video', owned_by: 'lab', pricing: { second: '0.01' }, video_capabilities: { supported_operations: ['text-to-video'], generate_audio: false } },
  { id: 'lab/video-url-only', name: 'Video URL Only', type: 'video', owned_by: 'lab', pricing: { second: '0.06' }, video_capabilities: { supported_operations: ['image-to-video'], supported_durations_seconds: [5], generate_audio: true, input_limits: { image: { max_count: 1, supported_sources: ['url'] }, audio: { supported_sources: ['url'], max_duration_seconds: 10 } } } },
  { id: 'openai/tts-1', name: 'TTS', type: 'speech', owned_by: 'openai', pricing: { speech_input_character_cost: '0.000015' } },
] });

function wavBuffer(seconds, byteRate = 1000) {
  const dataSize = seconds * byteRate;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(byteRate, 24); buffer.writeUInt32LE(byteRate, 28); buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function generators(calls) {
  return {
    image: async (args) => { calls.push({ modality: 'image', ...args }); return { media: [{ mediaType: 'image/png', base64: PNG.split(',')[1] }], warnings: [] }; },
    video: async (args) => { calls.push({ modality: 'video', ...args }); return { media: [{ mediaType: 'video/mp4', uint8Array: new Uint8Array([0, 1, 2]) }], warnings: [] }; },
    audio: async (args) => { calls.push({ modality: 'audio', ...args }); return { media: [{ mediaType: 'audio/wav', uint8Array: new Uint8Array(wavBuffer(3)) }], warnings: [] }; },
  };
}

async function temporaryStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pgs-store-'));
  let tick = 0;
  const store = new StudioStore({ rootDir: root, now: () => new Date(Date.UTC(2026, 8, 27, 12, 0, tick++)) });
  return { store, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('catalog exposes video capabilities and resolution helpers', () => {
  const sync = catalog.find((model) => model.id === 'lab/video-sync');
  assert.deepEqual(sync.features.durations, [4, 8, 12]);
  assert.equal(sync.features.inputs.audio.maxSeconds, 10);
  assert.equal(acceptsReferenceAudio(sync), true);
  assert.equal(acceptsReferenceAudio(catalog.find((model) => model.id === 'lab/video-native')), false);
  assert.equal(catalog.find((model) => model.id === 'openai/gpt-image-1.5').features.inputs.image.maxCount, 16);
  assert.equal(catalog.find((model) => model.id === 'lab/image-edit').features.inputs.image, undefined);
  assert.equal(resolutionToDimensions('720p', '16:9'), '1280x720');
  assert.equal(resolutionToDimensions('720p', '9:16'), '720x1280');
  assert.equal(resolutionToDimensions('1080p', '1:1'), '1080x1080');
  assert.equal(resolutionToDimensions('weird'), null);
});

test('video pricing follows the requested resolution and audio tier', () => {
  const native = catalog.find((model) => model.id === 'lab/video-native');
  assert.equal(pickVideoRate(native.pricing.video_duration_pricing, { resolution: '720p', generateAudio: true }).rate, 0.15);
  assert.equal(pickVideoRate(native.pricing.video_duration_pricing, { resolution: '720p', generateAudio: false }).rate, 0.1);
  const plan = planGeneration(catalog, { modality: 'video', prompt: 'x', model: 'lab/video-sync', resolution: '1080p', aspectRatio: '9:16', duration: 4 }, { maxCostUsd: null });
  assert.equal(plan.input.resolution, '1080x1920');
  assert.equal(plan.estimate.amount, 0.4);
  assert.deepEqual(toReferenceFile('https://cdn.example.com/a.png'), { type: 'url', url: 'https://cdn.example.com/a.png' });
  assert.equal(toReferenceFile(PNG).mediaType, 'image/png');
  assert.equal(sizeForAspectRatio({ id: 'bytedance/seedream-4.5', provider: 'bytedance' }, '3:4'), '1536x2048');
  assert.equal(sizeForAspectRatio({ id: 'bytedance/seedream-4.5', provider: 'bytedance' }, '16:9'), '2048x1152');
  assert.equal(sizeForAspectRatio({ id: 'recraft/recraft-v4', provider: 'recraft' }, '16:9'), '1820x1024');
  assert.equal(sizeForAspectRatio({ id: 'openai/gpt-image-1', provider: 'openai' }, '16:9'), undefined);
  assert.deepEqual(withProviderResolution({ provider: 'spacexai' }, '480p', { gateway: { tags: [] } }), { gateway: { tags: [] }, xai: { resolution: '480p' } });
  assert.deepEqual(withProviderResolution({ provider: 'google' }, '480p', { gateway: {} }), { gateway: {} });
});

test('prompt composition resolves mentions, continuity blocks and character sheets', () => {
  const elements = [
    { id: 'e1', kind: 'character', name: 'Maya Diop', description: 'Femme de 30 ans, cheveux courts.', images: [{ file: 'maya.png' }] },
    { id: 'e2', kind: 'place', name: 'Plage', description: 'Plage de Dakar au crépuscule.', images: [] },
  ];
  assert.equal(extractMentions('@Maya au bord de la @plage', elements).length, 2);
  const composed = composePrompt({ prompt: '@Maya marche sur la @Plage', elements, selectedIds: ['e2'], styleNotes: 'Grain argentique' });
  assert.match(composed.text, /^Maya Diop marche sur la Plage/);
  assert.match(composed.text, /Maya Diop, character \(see reference image 1\): Femme de 30 ans/);
  assert.match(composed.text, /Plage, location: Plage de Dakar/);
  assert.match(composed.text, /Project style: Grain argentique/);
  assert.deepEqual(composed.elementIds, ['e1', 'e2']);
  assert.equal(composed.referenceFiles.length, 1);
  assert.match(characterSheetPrompt({ name: 'Maya', description: 'cheveux courts', style: 'photoreal' }), /Split-screen character sheet.*cheveux courts.*no beauty filter/s);
  assert.match(characterSheetPrompt({ name: 'Plage', description: 'sable blanc', kind: 'place' }), /Location reference sheet/);
});

test('store manages workspaces, elements with images and generations on disk', async () => {
  const { store, cleanup } = await temporaryStore();
  try {
    const workspace = await store.createWorkspace({ name: 'Campagne été', settings: { styleNotes: 'Lumière dorée' } });
    assert.equal((await store.listWorkspaces())[0].id, workspace.id);
    await assert.rejects(store.getWorkspace('missing'), (error) => error instanceof StudioStoreError && error.status === 404);
    await assert.rejects(store.createWorkspace({ name: '' }), /Too small|expected string|at least/i);

    const element = await store.createElement(workspace.id, { kind: 'avatar', name: 'Maya', description: 'Présentatrice', voice: { model: 'openai/tts-1', voice: 'nova' } }, { images: [{ dataUrl: PNG, source: 'upload' }] });
    assert.equal(element.images.length, 1);
    assert.match(element.images[0].url, /\/api\/studio\/workspaces\/.+\/media\/.+\.png$/);
    assert.ok((await stat(store.mediaPath(workspace.id, element.images[0].file))).size > 0);
    assert.equal((await store.findElementsByName(workspace.id, ['maya']))[0].id, element.id);

    const updated = await store.updateElement(workspace.id, element.id, { description: 'Présentatrice TV' }, { addImages: [{ dataUrl: PNG, source: 'generated' }] });
    assert.equal(updated.images.length, 2);
    const promoted = await store.updateElement(workspace.id, element.id, {}, { primaryImageId: updated.images[1].id });
    assert.equal(promoted.images[0].id, updated.images[1].id);
    const trimmed = await store.updateElement(workspace.id, element.id, {}, { removeImageIds: [updated.images[0].id] });
    assert.equal(trimmed.images.length, 1);
    await assert.rejects(stat(store.mediaPath(workspace.id, updated.images[0].file)));

    const generation = await store.createGeneration(workspace.id, { kind: 'image', modality: 'image', prompt: 'Un phare', model: { id: 'lab/x', name: 'X', provider: 'lab' }, estimate: { amount: 0.02 }, media: [{ mediaType: 'image/png', base64: PNG.split(',')[1] }], elementIds: [element.id] });
    assert.equal(generation.files[0].mediaType, 'image/png');
    assert.equal((await store.listGenerations(workspace.id)).length, 1);
    assert.equal((await store.updateGeneration(workspace.id, generation.id, { favorite: true })).favorite, true);
    const summary = await store.workspaceSummary(workspace.id);
    assert.equal(summary.counts.elements, 1);
    assert.equal(summary.estimatedSpendUsd, 0.02);

    assert.throws(() => store.mediaPath(workspace.id, '../secret'), /Invalid media file name/);
    await store.deleteGeneration(workspace.id, generation.id);
    await store.deleteElement(workspace.id, element.id);
    await store.deleteWorkspace(workspace.id);
    assert.deepEqual(await store.listWorkspaces(), []);
    assert.equal((await store.ensureDefaultWorkspace()).name, 'Mon premier projet');
    assert.match(await readFile(store.workspacesFile(), 'utf8'), /Mon premier projet/);
  } finally {
    await cleanup();
  }
});

test('workspace generation injects element references and records the result', async () => {
  const { store, cleanup } = await temporaryStore();
  try {
    const workspace = await store.createWorkspace({ name: 'Projet', settings: { styleNotes: 'Style éditorial' } });
    const maya = await store.createElement(workspace.id, { kind: 'character', name: 'Maya', description: 'Cheveux courts' }, { images: [{ dataUrl: PNG }] });
    const calls = [];
    const generation = await generateInWorkspace({ store, workspaceId: workspace.id, catalog, generators: generators(calls), maxCostUsd: null, request: { modality: 'image', prompt: '@Maya sur un balcon', model: 'openai/gpt-image-1.5', mode: 'manual', aspectRatio: '3:4' } });
    assert.equal(calls[0].referenceImages.length, 1);
    assert.match(calls[0].referenceImages[0], /^data:image\/png;base64,/);
    assert.match(calls[0].prompt, /Maya sur un balcon[\s\S]*Continuity references[\s\S]*Project style: Style éditorial/);
    assert.deepEqual(generation.elementIds, [maya.id]);
    assert.equal(generation.kind, 'image');
    assert.equal(generation.params.referenceCount, 1);

    const textOnly = await generateInWorkspace({ store, workspaceId: workspace.id, catalog, generators: generators(calls), maxCostUsd: null, request: { modality: 'image', prompt: 'Portrait', elementIds: [maya.id], model: 'lab/image-edit', mode: 'manual' } });
    assert.equal(calls[1].referenceImages.length, 0);
    assert.equal(textOnly.warnings[0].feature, 'referenceImages');

    const video = await generateInWorkspace({ store, workspaceId: workspace.id, catalog, generators: generators(calls), maxCostUsd: null, request: { modality: 'video', prompt: 'Elle se retourne', model: 'lab/video-sync', mode: 'manual', startImage: `studio://${workspace.id}/${generation.files[0].file}`, resolution: '720p', aspectRatio: '9:16', duration: 4, parentId: generation.id } });
    assert.match(calls[2].startImage, /^data:image\/png/);
    assert.equal(calls[2].resolution, '720x1280');
    assert.equal(video.parentId, generation.id);
    assert.equal(video.params.startImage, true);
    await assert.rejects(generateInWorkspace({ store, workspaceId: workspace.id, catalog, generators: generators(calls), maxCostUsd: null, request: { modality: 'video', prompt: 'x', startImage: 'studio://other/file.png' } }), /another workspace/);
    await assert.rejects(generateInWorkspace({ store, workspaceId: workspace.id, catalog, generators: generators(calls), maxCostUsd: null, request: { modality: 'video', prompt: 'x', model: 'lab/video-url-only', mode: 'manual', startImage: PNG } }), (error) => error.code === 'public_url_required');
    const hosted = await generateInWorkspace({ store, workspaceId: workspace.id, catalog, generators: generators(calls), maxCostUsd: null, publicMedia: { baseUrl: 'https://studio.example.com', secret: 's' }, request: { modality: 'video', prompt: 'x', model: 'lab/video-url-only', mode: 'manual', startImage: PNG, duration: 5 } });
    assert.match(calls.at(-1).startImage, /^https:\/\/studio\.example\.com\/api\/studio\/public\/[a-f0-9]{40}\/.+start-frame.+\.png$/);
    assert.equal(hosted.params.startImage, true);

    const estimate = await estimateInWorkspace({ store, workspaceId: workspace.id, catalog, request: { modality: 'image', prompt: '@Maya', model: 'lab/image-edit', mode: 'manual' } });
    assert.equal(estimate.model.id, 'lab/image-edit');
    assert.equal(estimate.elements[0].name, 'Maya');
    assert.equal(estimate.warnings.length, 1);
  } finally {
    await cleanup();
  }
});

test('video dialogue synthesizes the voice, fits the duration and stores both tracks', async () => {
  assert.equal(wavDurationSeconds(wavBuffer(3)), 3);
  assert.equal(wavDurationSeconds(Buffer.from('not a wav file at all, really not')), null);
  const streaming = wavBuffer(4); streaming.writeUInt32LE(0xffffffff, 40);
  assert.equal(wavDurationSeconds(streaming), 4);
  const zeroSized = wavBuffer(2); zeroSized.writeUInt32LE(0, 40);
  assert.equal(wavDurationSeconds(zeroSized), 2);
  assert.equal(estimateSpeechSeconds('a'.repeat(45)), 3);
  const sync = catalog.find((model) => model.id === 'lab/video-sync');
  assert.equal(pickVideoDuration(sync, 3.2), 4);
  assert.equal(pickVideoDuration(sync, 9), 12);
  assert.equal(pickVideoDuration(sync, 20), 12);
  assert.equal(pickVideoDuration({ features: { durations: [] } }, 7), 8);
  assert.equal(chooseVideoModelForSpeech(catalog, { mode: 'reference', videoMode: 'economy' }).id, 'lab/video-sync');
  assert.equal(chooseVideoModelForSpeech(catalog, { mode: 'native', videoMode: 'quality' }).id, 'lab/video-native');
  assert.throws(() => chooseVideoModelForSpeech(catalog, { mode: 'reference', requested: 'lab/video-native' }), /piste audio/);
  assert.match(withSpeechPrompt('Maya dans la cuisine', { script: 'Bonjour', language: 'fr', mode: 'native', speakerName: 'Maya' }), /^Maya dans la cuisine[\s\S]*Maya speaks to camera[\s\S]*say exactly: "Bonjour"/);

  const { store, cleanup } = await temporaryStore();
  try {
    const workspace = await store.createWorkspace({ name: 'Projet' });
    const avatar = await store.createElement(workspace.id, { kind: 'avatar', name: 'Maya', description: 'Présentatrice', voice: { model: 'openai/tts-1', voice: 'nova' } }, { images: [{ dataUrl: PNG }] });
    const calls = [];
    const publicMedia = { baseUrl: 'https://studio.example.com', secret: 'secret' };
    const base = { store, workspaceId: workspace.id, catalog, maxCostUsd: null };

    await assert.rejects(generateInWorkspace({ ...base, generators: generators(calls), request: { modality: 'video', prompt: '@Maya présente le studio', speech: { script: 'Bonjour' } } }), (error) => error.code === 'public_url_required');
    assert.equal(calls.length, 0, 'no paid call happens before the public URL check');

    const generation = await generateInWorkspace({ ...base, generators: generators(calls), publicMedia, request: { modality: 'video', prompt: '@Maya présente le studio', aspectRatio: '9:16', resolution: '720p', speech: { script: 'Bonjour à tous, bienvenue dans le studio.' } } });
    assert.equal(calls[0].modality, 'audio');
    assert.equal(calls[0].voice, 'nova');
    assert.equal(calls[0].outputFormat, 'wav');
    assert.equal(calls[1].modality, 'video');
    assert.equal(calls[1].model.id, 'lab/video-sync');
    assert.equal(calls[1].duration, 4);
    assert.match(calls[1].referenceAudio, /^https:\/\/studio\.example\.com\/api\/studio\/public\/[a-f0-9]{40}\/.+\.wav$/);
    assert.match(calls[1].startImage, /^data:image\/png/, 'the speaker portrait becomes the first frame');
    assert.match(calls[1].prompt, /Maya speaks to camera[\s\S]*provided voice track/);
    assert.equal(generation.kind, 'video');
    assert.deepEqual(generation.files.map((file) => file.role), ['output', 'audio']);
    assert.equal(generation.params.speech.seconds, 3);
    assert.equal(generation.params.speech.speaker.name, 'Maya');
    assert.deepEqual(generation.elementIds, [avatar.id]);
    assert.ok(generation.estimate.amount > 0.2);
    const audioFile = generation.files.find((file) => file.role === 'audio');
    assert.equal(calls[1].referenceAudio, publicMediaUrl(publicMedia, workspace.id, audioFile.file));
    assert.equal(verifyMediaToken(signMedia(workspace.id, audioFile.file, 'secret'), workspace.id, audioFile.file, 'secret'), true);
    assert.equal(verifyMediaToken(signMedia(workspace.id, audioFile.file, 'other'), workspace.id, audioFile.file, 'secret'), false);
    assert.equal(publicMediaConfig({}), null);
    assert.deepEqual(publicMediaConfig({ STUDIO_PUBLIC_URL: 'https://x.test/', AUTH_SECRET: 's' }), { baseUrl: 'https://x.test', secret: 's' });

    await assert.rejects(generateInWorkspace({ ...base, generators: generators(calls), publicMedia, request: { modality: 'video', prompt: 'x', speech: { script: 'x'.repeat(400), speakerId: avatar.id } } }), (error) => error.code === 'script_too_long');
    await assert.rejects(generateInWorkspace({ ...base, generators: generators(calls), publicMedia, request: { modality: 'video', prompt: 'x', model: 'lab/video-native', speech: { script: 'Salut' } } }), (error) => error.code === 'model_incompatible');

    const native = await generateInWorkspace({ ...base, generators: generators(calls), request: { modality: 'video', prompt: 'Une cuisinière explique sa recette', model: 'lab/video-native', aspectRatio: '16:9', speech: { script: 'Salut', mode: 'native' } } });
    assert.equal(native.files.length, 1);
    assert.equal(calls.at(-1).generateAudio, true);
    assert.equal(calls.at(-1).startImage, undefined);
    assert.match(calls.at(-1).prompt, /The speaking character speaks to camera[\s\S]*say exactly: "Salut"/);
    assert.equal(native.params.speech.mode, 'native');

    const estimate = await estimateInWorkspace({ ...base, request: { modality: 'video', prompt: '@Maya', speech: { script: 'Bonjour à tous, bienvenue.' } } });
    assert.equal(estimate.model.id, 'lab/video-sync');
    assert.equal(estimate.duration, 4);
    assert.equal(estimate.speechModel.id, 'openai/tts-1');
    assert.ok(estimate.estimate.amount > 0.2);
  } finally {
    await cleanup();
  }
});
