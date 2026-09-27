import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeGatewayCatalog } from '../../lib/gateway/catalog.mjs';
import { GenerationError, compatibleModels, generate, loadGatewayCatalog, planGeneration, runGeneration } from '../../lib/gateway/engine.mjs';
import { estimateGenerationCost, formatEstimate } from '../../lib/gateway/estimate.mjs';

const catalog = normalizeGatewayCatalog({ data: [
  { id: 'lab/image-pro', name: 'Image Pro', type: 'image', pricing: { image: '0.08' } },
  { id: 'lab/image-fast', name: 'Image Fast', type: 'image', pricing: { image: '0.01' } },
  { id: 'lab/image-tokens', name: 'Image Tokens', type: 'image', pricing: { input: '0.000001', output: '0.00004' } },
  { id: 'lab/video-pro', name: 'Video Pro', type: 'video', pricing: { video_duration_pricing: [{ cost_per_second: '0.05' }, { cost_per_second: '0.09' }] } },
  { id: 'lab/video-flat', name: 'Video Flat', type: 'video', pricing: { request: '0.40' } },
  { id: 'lab/speech-fast', name: 'Speech Fast', type: 'speech', pricing: { speech_input_character_cost: '0.000015' } },
  { id: 'lab/transcribe', name: 'Transcribe', type: 'transcription', pricing: { audio: '0.006' } },
] });

const fakeGenerators = {
  image: async ({ count }) => ({ media: Array.from({ length: count }, () => ({ mediaType: 'image/png', base64: Buffer.from('png').toString('base64') })), warnings: [] }),
  video: async () => ({ media: [{ mediaType: 'video/mp4', uint8Array: new Uint8Array([1, 2, 3]) }], warnings: [{ type: 'unsupported-setting', setting: 'fps' }] }),
  audio: async () => ({ media: [{ mediaType: 'audio/mpeg', base64: Buffer.from('mp3').toString('base64') }], warnings: [] }),
};

test('estimates image, video and speech costs from published Gateway prices', () => {
  const image = catalog.find((model) => model.id === 'lab/image-pro');
  assert.deepEqual(estimateGenerationCost(image, { count: 2 }).amount, 0.16);
  assert.equal(estimateGenerationCost(catalog.find((model) => model.id === 'lab/image-tokens'), {}).amount, null);

  const video = catalog.find((model) => model.id === 'lab/video-pro');
  const assumed = estimateGenerationCost(video, {});
  assert.equal(assumed.amount, 0.25);
  assert.equal(assumed.assumed, true);
  assert.equal(estimateGenerationCost(video, { duration: 8 }).amount, 0.4);
  assert.equal(estimateGenerationCost(catalog.find((model) => model.id === 'lab/video-flat'), { count: 2 }).amount, 0.8);

  const speech = catalog.find((model) => model.id === 'lab/speech-fast');
  assert.equal(estimateGenerationCost(speech, { prompt: 'Bonjour le monde' }).amount, 0.00024);
  assert.match(formatEstimate(assumed), /USD/);
  assert.match(formatEstimate({ amount: null, basis: 'x' }), /unknown/);
});

test('planning validates input, routes models and only keeps speech models for audio', () => {
  assert.deepEqual(compatibleModels(catalog, 'audio').map((model) => model.id), ['lab/speech-fast']);

  const plan = planGeneration(catalog, { modality: 'image', prompt: 'Un phare breton', mode: 'economy' }, { maxCostUsd: null });
  assert.equal(plan.model.id, 'lab/image-fast');
  assert.equal(plan.input.count, 1);
  assert.equal(plan.estimate.amount, 0.01);

  assert.throws(() => planGeneration(catalog, { modality: 'image', prompt: '' }), (error) => error instanceof GenerationError && error.status === 400);
  assert.throws(() => planGeneration(catalog, { modality: 'image', prompt: 'x', mode: 'manual' }), (error) => error.code === 'model_required');
  assert.throws(() => planGeneration(catalog, { modality: 'video', prompt: 'x', model: 'lab/image-pro' }), (error) => error.code === 'model_unavailable' && error.status === 409);
});

test('planning refuses generations above the configured budget', () => {
  assert.throws(
    () => planGeneration(catalog, { modality: 'video', prompt: 'Clip', model: 'lab/video-pro', duration: 30 }, { maxCostUsd: 1 }),
    (error) => error.code === 'budget_exceeded' && error.status === 422 && error.details.estimate.amount === 1.5,
  );
  assert.equal(planGeneration(catalog, { modality: 'video', prompt: 'Clip', model: 'lab/video-pro', duration: 30 }, { maxCostUsd: 2 }).model.id, 'lab/video-pro');
  assert.equal(planGeneration(catalog, { modality: 'image', prompt: 'x', model: 'lab/image-tokens' }, { maxCostUsd: 0 }).estimate.amount, null);
});

test('runGeneration passes the plan to the modality generator and normalizes media', async () => {
  const plan = planGeneration(catalog, { modality: 'image', prompt: 'Deux affiches', count: 2 }, { maxCostUsd: null });
  const result = await runGeneration(plan, { generators: fakeGenerators });
  assert.equal(result.media.length, 2);
  assert.equal(result.media[0].mediaType, 'image/png');
  assert.equal(result.model.id, plan.model.id);

  const video = await generate({ modality: 'video', prompt: 'Vagues', duration: 4 }, { catalog, generators: fakeGenerators, maxCostUsd: null });
  assert.equal(video.media[0].mediaType, 'video/mp4');
  assert.equal(video.warnings.length, 1);
});

test('provider failures are wrapped into actionable GenerationErrors', async () => {
  const plan = planGeneration(catalog, { modality: 'audio', prompt: 'Bonjour' }, { maxCostUsd: null });
  await assert.rejects(
    runGeneration(plan, { generators: { audio: async () => { throw new Error('Set the AI_GATEWAY_API_KEY environment variable'); } } }),
    (error) => error instanceof GenerationError && error.code === 'gateway_auth' && error.status === 502,
  );
  await assert.rejects(
    runGeneration(plan, { generators: { audio: async () => { throw new Error('boom'); } } }),
    (error) => error.code === 'generation_failed' && /boom/.test(error.message),
  );
});

test('catalog loading reports unreachable or failing Gateway endpoints', async () => {
  await assert.rejects(loadGatewayCatalog({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), (error) => error.code === 'catalog_unavailable' && /ECONNREFUSED/.test(error.message));
  await assert.rejects(loadGatewayCatalog({ fetchImpl: async () => new Response('nope', { status: 500 }) }), (error) => error.code === 'catalog_unavailable');
  const models = await loadGatewayCatalog({ fetchImpl: async () => Response.json({ data: [{ id: 'lab/x', type: 'image' }] }) });
  assert.equal(models[0].id, 'lab/x');
});
