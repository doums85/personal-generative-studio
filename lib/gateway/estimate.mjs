const DEFAULT_VIDEO_SECONDS = 5;

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
    const perSecond = lowestVariant(pricing.video_duration_pricing, 'cost_per_second') ?? numericPrice(pricing.second);
    if (perSecond !== null) {
      const assumed = !Number.isFinite(input.duration);
      const seconds = assumed ? DEFAULT_VIDEO_SECONDS : input.duration;
      return {
        amount: round(perSecond * seconds * count),
        currency: 'USD',
        basis: `${count} × ${seconds}s × ${perSecond} USD per second${assumed ? ' (duration assumed)' : ''}`,
        assumed,
      };
    }
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
