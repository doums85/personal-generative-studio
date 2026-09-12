const MODALITY_BY_TYPE = {
  language: 'language',
  image: 'image',
  video: 'video',
  speech: 'audio',
  transcription: 'audio',
  realtime: 'audio',
};

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function lowestKnownPrice(pricing = {}) {
  const prices = [pricing.input, pricing.output, pricing.image, pricing.video, pricing.audio, pricing.request, pricing.second]
    .map(numberOrNull)
    .filter((value) => value !== null && value >= 0);
  return prices.length ? Math.min(...prices) : null;
}

export function normalizeGatewayModel(model) {
  return {
    id: model.id,
    name: model.name || model.id,
    description: model.description || '',
    modality: MODALITY_BY_TYPE[model.type] || 'language',
    operation: model.type || 'language',
    provider: model.owned_by || model.id?.split('/')[0] || 'unknown',
    pricing: model.pricing || {},
    lowestKnownPrice: lowestKnownPrice(model.pricing),
    capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
    releasedAt: model.created ? new Date(model.created * 1000).toISOString() : null,
  };
}

export function normalizeGatewayCatalog(payload) {
  const source = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(source)) return [];
  return source
    .filter((model) => typeof model?.id === 'string' && model.id.includes('/'))
    .map(normalizeGatewayModel)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function groupModelsByModality(models) {
  return models.reduce((groups, model) => {
    groups[model.modality] ??= [];
    groups[model.modality].push(model);
    return groups;
  }, { language: [], image: [], video: [], audio: [] });
}
