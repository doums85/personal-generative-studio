import assert from 'node:assert/strict';
import test from 'node:test';
import { getModelPriceSummary, lowestKnownPrice } from '../../lib/gateway/pricing.mjs';

test('formats flat image pricing per generated image', () => {
  assert.match(getModelPriceSummary({ modality: 'image', pricing: { image: '0.04' } }), /0,04.*image/);
});

test('formats token pricing as a price per million tokens', () => {
  const summary = getModelPriceSummary({ modality: 'image', pricing: { input: '0.000005', output: '0.00004' } });
  assert.match(summary, /5.*M tokens d’entrée/);
  assert.match(summary, /40.*M tokens de sortie/);
});

test('reads nested video duration pricing', () => {
  const pricing = { video_duration_pricing: [{ resolution: '720p', cost_per_second: '0.1' }, { resolution: '480p', cost_per_second: '0.05' }] };
  assert.equal(lowestKnownPrice(pricing), 0.05);
  assert.match(getModelPriceSummary({ modality: 'video', pricing }), /0,05.*seconde/);
});

test('formats speech character pricing per million characters', () => {
  const summary = getModelPriceSummary({ modality: 'audio', pricing: { speech_input_character_cost: '0.000015' } });
  assert.match(summary, /15.*M caractères/);
});
