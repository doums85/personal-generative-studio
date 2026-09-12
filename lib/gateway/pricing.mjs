const DIRECT_PRICE_UNITS = {
  image: 'image',
  request: 'génération',
  second: 'seconde',
  audio: 'minute audio',
  input: "token d’entrée",
  output: 'token de sortie',
  input_audio: "token audio d’entrée",
  output_audio: 'token audio de sortie',
  character: 'caractère',
  characters: 'caractère',
};

function numericPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function collectKnownPrices(pricing = {}) {
  const prices = [];

  function visit(value, key = '') {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
      return;
    }

    if (!/(price|cost|input|output|image|audio|video|request|second|character|token)/i.test(key)) return;
    const price = numericPrice(value);
    if (price !== null) prices.push(price);
  }

  visit(pricing);
  return prices;
}

export function lowestKnownPrice(pricing = {}) {
  const prices = collectKnownPrices(pricing);
  return prices.length ? Math.min(...prices) : null;
}

export function comparableUnitPrice(modality, pricing = {}) {
  if (modality === 'image') {
    const direct = numericPrice(pricing.image) ?? numericPrice(pricing.request);
    if (direct !== null) return direct;
    const variants = Array.isArray(pricing.image_dimension_quality_pricing)
      ? pricing.image_dimension_quality_pricing.map((item) => numericPrice(item?.cost)).filter((value) => value !== null)
      : [];
    return variants.length ? Math.min(...variants) : null;
  }

  if (modality === 'video') {
    const durations = Array.isArray(pricing.video_duration_pricing)
      ? pricing.video_duration_pricing.map((item) => numericPrice(item?.cost_per_second)).filter((value) => value !== null)
      : [];
    if (durations.length) return Math.min(...durations);
    return numericPrice(pricing.second) ?? numericPrice(pricing.video) ?? numericPrice(pricing.request);
  }

  if (modality === 'audio') {
    const characterCost = numericPrice(pricing.speech_input_character_cost);
    if (characterCost !== null) return characterCost * 1_000_000;
    return numericPrice(pricing.audio) ?? numericPrice(pricing.request) ?? null;
  }

  return lowestKnownPrice(pricing);
}

function currency(value) {
  const maximumFractionDigits = value < 0.01 ? 6 : value < 1 ? 4 : 2;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

function perMillion(value, unit) {
  return `${currency(value * 1_000_000)}/M ${unit}`;
}

function directPrice(pricing, keys) {
  for (const key of keys) {
    const value = numericPrice(pricing?.[key]);
    if (value !== null) return { value, unit: DIRECT_PRICE_UNITS[key] || key };
  }
  return null;
}

export function getModelPriceSummary(model) {
  const pricing = model?.pricing || {};

  if (model?.modality === 'video') {
    const durations = Array.isArray(pricing.video_duration_pricing)
      ? pricing.video_duration_pricing.map((item) => numericPrice(item?.cost_per_second)).filter((value) => value !== null)
      : [];
    if (durations.length) {
      return `Dès ${currency(Math.min(...durations))}/seconde`;
    }
    const result = directPrice(pricing, ['second', 'video', 'request']);
    if (result) return `${currency(result.value)}/${result.unit}`;
  }

  if (model?.modality === 'image') {
    const result = directPrice(pricing, ['image', 'request']);
    if (result) return `${currency(result.value)}/${result.unit}`;
    const generatedImageCosts = Array.isArray(pricing.image_dimension_quality_pricing)
      ? pricing.image_dimension_quality_pricing.map((item) => numericPrice(item?.cost)).filter((value) => value !== null)
      : [];
    if (generatedImageCosts.length) return `Dès ${currency(Math.min(...generatedImageCosts))}/image`;
    const input = numericPrice(pricing.input);
    const output = numericPrice(pricing.output);
    if (input !== null || output !== null) {
      return [input !== null ? perMillion(input, "tokens d’entrée") : null, output !== null ? perMillion(output, 'tokens de sortie') : null].filter(Boolean).join(' · ');
    }
  }

  if (model?.modality === 'audio') {
    const characterCost = numericPrice(pricing.speech_input_character_cost);
    if (characterCost !== null) return perMillion(characterCost, 'caractères');
    const result = directPrice(pricing, ['audio', 'request']);
    if (result) return `${currency(result.value)}/${result.unit}`;
    const input = numericPrice(pricing.input);
    if (input !== null) return perMillion(input, 'unités d’entrée');
  }

  const lowest = lowestKnownPrice(pricing);
  return lowest === null ? 'Prix non communiqué' : `Dès ${currency(lowest)}`;
}
