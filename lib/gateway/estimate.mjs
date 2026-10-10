const DEFAULT_VIDEO_SECONDS = 5;
const DEFAULT_VIDEO_FPS = 24;

function numericPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function unknown(reason) {
  return { amount: null, currency: 'USD', basis: reason, assumed: false };
}

function lowestVariant(list, key) {
  if (!Array.isArray(list)) return null;
  const values = list.map((item) => numericPrice(item?.[key])).filter((value) => value !== null);
  return values.length ? Math.min(...values) : null;
}

function normalizeResolution(value) {
  return String(value || '').trim().toLowerCase();
}

function resolutionHeight(value) {
  const label = normalizeResolution(value);
  const match = label.match(/^(\d{2,5})x(\d{2,5})$/);
  if (match) return Math.min(Number(match[1]), Number(match[2]));
  const byLabel = { '360p': 360, '480p': 480, '720p': 720, '768p': 768, hd: 720, fhd: 1080, '1080p': 1080, '2k': 1440, '4k': 2160, '2160p': 2160 };
  return byLabel[label] ?? null;
}

/**
 * Picks the per-second rate that matches the requested resolution and audio setting.
 * Falls back to the cheapest published tier when nothing matches exactly.
 */
export function pickVideoRate(tiers, { resolution, generateAudio } = {}) {
  if (!Array.isArray(tiers) || !tiers.length) return null;
  const wantedHeight = resolutionHeight(resolution);
  let candidates = tiers.filter((tier) => numericPrice(tier?.cost_per_second) !== null);
  if (wantedHeight !== null) {
    const byResolution = candidates.filter((tier) => tier.resolution === undefined || resolutionHeight(tier.resolution) === wantedHeight);
    if (byResolution.length) candidates = byResolution;
  }
  if (typeof generateAudio === 'boolean') {
    const byAudio = candidates.filter((tier) => tier.audio === undefined || tier.audio === generateAudio);
    if (byAudio.length) candidates = byAudio;
  }
  const rates = candidates.map((tier) => numericPrice(tier.cost_per_second));
  if (!rates.length) return null;
  const exact = wantedHeight !== null && candidates.every((tier) => tier.resolution !== undefined);
  return { rate: Math.min(...rates), exact };
}

function tokenBasedVideoEstimate(pricing, input, count) {
  const tiers = pricing?.video_token_pricing?.tiers;
  if (!Array.isArray(tiers) || !tiers.length) return null;
  const wantedHeight = resolutionHeight(input.resolution) ?? 720;
  const tier = tiers.find((item) => resolutionHeight(item.resolution) === wantedHeight) || tiers[0];
  const perMillion = numericPrice(tier?.no_video_input?.cost_per_million_tokens) ?? numericPrice(tier?.cost_per_million_tokens);
  if (perMillion === null) return null;
  const seconds = Number.isFinite(input.duration) ? input.duration : DEFAULT_VIDEO_SECONDS;
  const height = resolutionHeight(tier?.resolution) ?? wantedHeight;
  const [w, h] = String(input.aspectRatio || '16:9').split(':').map(Number);
  const width = w && h ? Math.round((height * Math.max(w, h)) / Math.min(w, h)) : Math.round((height * 16) / 9);
  const tokens = (width * height * DEFAULT_VIDEO_FPS * seconds) / 1024;
  return {
    amount: round((tokens / 1_000_000) * perMillion * count),
    currency: 'USD',
    basis: `${count} × ≈${Math.round(tokens).toLocaleString('en-US')} video tokens (${width}x${height}, ${seconds}s) × ${perMillion} USD per million tokens (approximation)`,
    assumed: true,
  };
}

/**
 * Estimates the cost of one generation request before any paid call is made.
 * Returns `amount: null` when the Gateway does not publish a comparable unit price.
 */
export function estimateGenerationCost(model, input = {}) {
  const pricing = model?.pricing || {};
  const count = Math.max(1, Number(input.count) || 1);

  if (model?.modality === 'image') {
    const perImage = numericPrice(pricing.image)
      ?? numericPrice(pricing.request)
      ?? lowestVariant(pricing.image_dimension_quality_pricing, 'cost');
    if (perImage === null) return unknown('Image pricing is token-based or unpublished for this model');
    return { amount: round(perImage * count), currency: 'USD', basis: `${count} × ${perImage} USD per image`, assumed: false };
  }

  if (model?.modality === 'video') {
    const picked = pickVideoRate(pricing.video_duration_pricing, input);
    const perSecond = picked?.rate ?? numericPrice(pricing.second);
    if (perSecond !== null) {
      const assumedDuration = !Number.isFinite(input.duration);
      const seconds = assumedDuration ? DEFAULT_VIDEO_SECONDS : input.duration;
      const tierNote = picked && !picked.exact && input.resolution ? ', cheapest tier' : '';
      return {
        amount: round(perSecond * seconds * count),
        currency: 'USD',
        basis: `${count} × ${seconds}s × ${perSecond} USD per second${assumedDuration ? ' (duration assumed)' : ''}${tierNote}`,
        assumed: assumedDuration,
      };
    }
    const tokenBased = tokenBasedVideoEstimate(pricing, input, count);
    if (tokenBased) return tokenBased;
    const perVideo = numericPrice(pricing.video) ?? numericPrice(pricing.request);
    if (perVideo === null) return unknown('Video pricing is unpublished for this model');
    return { amount: round(perVideo * count), currency: 'USD', basis: `${count} × ${perVideo} USD per video`, assumed: false };
  }

  if (model?.modality === 'audio') {
    const perCharacter = numericPrice(pricing.speech_input_character_cost);
    const characters = typeof input.prompt === 'string' ? input.prompt.length : 0;
    if (perCharacter !== null) {
      return { amount: round(perCharacter * characters), currency: 'USD', basis: `${characters} characters × ${perCharacter} USD per character`, assumed: false };
    }
    const perAudioToken = numericPrice(pricing.audio_output_token_cost) ?? numericPrice(pricing.output);
    if (perAudioToken !== null) {
      // Google TTS bills audio output tokens: roughly 25 tokens per second, and speech runs near 15 characters per second.
      const seconds = Math.max(1, characters / 15);
      const tokens = Math.round(seconds * 25) + Math.round(characters / 4);
      return { amount: round(perAudioToken * tokens), currency: 'USD', basis: `≈${tokens} audio tokens × ${perAudioToken} USD per token (approximation)`, assumed: true };
    }
    const perRequest = numericPrice(pricing.request);
    if (perRequest !== null) return { amount: round(perRequest), currency: 'USD', basis: `${perRequest} USD per request`, assumed: false };
    return unknown('Speech pricing is unpublished for this model');
  }

  return unknown('Unsupported modality');
}

export function formatEstimate(estimate) {
  if (!estimate || estimate.amount === null) return `unknown (${estimate?.basis || 'no published price'})`;
  return `≈ ${estimate.amount.toFixed(estimate.amount < 0.01 ? 5 : 3)} USD (${estimate.basis})`;
}
