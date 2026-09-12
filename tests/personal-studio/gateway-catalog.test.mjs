import assert from 'node:assert/strict';
import test from 'node:test';
import { groupModelsByModality, normalizeGatewayCatalog } from '../../lib/gateway/catalog.mjs';
import { selectModel } from '../../lib/gateway/routing.mjs';

const catalog = normalizeGatewayCatalog({ data: [
  { id: 'lab/image-pro', name: 'Image Pro', type: 'image', pricing: { image: '0.08' } },
  { id: 'lab/image-fast', name: 'Image Fast', type: 'image', pricing: { image: '0.01' } },
  { id: 'lab/video-pro', name: 'Video Pro', type: 'video', pricing: { second: '0.05' } },
  { id: 'lab/speech-fast', name: 'Speech Fast', type: 'speech', pricing: { input: '0.02' } },
  { id: 'invalid', type: 'image' },
] });

test('normalizes and groups discoverable Gateway models', () => {
  assert.equal(catalog.length, 4);
  const grouped = groupModelsByModality(catalog);
  assert.equal(grouped.image.length, 2);
  assert.equal(grouped.video.length, 1);
  assert.equal(grouped.audio[0].operation, 'speech');
});

test('manual routing never silently substitutes a missing model', () => {
  assert.equal(selectModel(catalog, { modality: 'image', requestedModel: 'lab/missing' }), null);
});

test('economy and quality policies make deterministic choices', () => {
  assert.equal(selectModel(catalog, { modality: 'image', mode: 'economy' }).id, 'lab/image-fast');
  assert.equal(selectModel(catalog, { modality: 'image', mode: 'quality' }).id, 'lab/image-pro');
});
